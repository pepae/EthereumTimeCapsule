import os, io, time, base64, json
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PIL import Image
import requests
import secrets
import hashlib

# Import private config
try:
    import config
    from config import PINATA_API_KEY, PINATA_SECRET_API_KEY, PINATA_GATEWAY
    # Try to import JWT token for V3 API
    PINATA_JWT = getattr(config, 'PINATA_JWT', None)
    
    # Check for V3 API (JWT) first, then fall back to V2 API
    if PINATA_JWT and PINATA_JWT != "your_pinata_jwt_token_here":
        PINATA_ENABLED = True
        PINATA_VERSION = "v3"
    elif PINATA_API_KEY and PINATA_SECRET_API_KEY and PINATA_API_KEY != "your_pinata_api_key_here":
        PINATA_ENABLED = True
        PINATA_VERSION = "v2"
    else:
        PINATA_ENABLED = False
        PINATA_VERSION = None
except ImportError:
    print("Warning: config.py not found, Pinata integration disabled")
    PINATA_ENABLED = False
    PINATA_VERSION = None
    PINATA_API_KEY = None
    PINATA_SECRET_API_KEY = None
    PINATA_GATEWAY = ""
    PINATA_JWT = None

SHUTTER_API_BASE   = "https://shutter-api.chiado.staging.shutter.network/api"
SHUTTER_REGISTRY   = os.getenv("SHUTTER_REGISTRY_ADDRESS", "0x2693a4Fb363AdD4356e6b80Ac5A27fF05FeA6D9F")
ONE_YEAR_SECONDS   = 365 * 24 * 60 * 60

app = Flask(__name__, static_folder="../frontend", static_url_path="/")
CORS(app, origins=["http://localhost:8080"])                               # allow the JS frontend (http://localhost:8080)

# ---------- helpers ----------
def pixelate(img, factor=12):
    w, h = img.size
    img_small = img.resize((max(1, w // factor), max(1, h // factor)), Image.BILINEAR)
    return img_small.resize((w, h), Image.NEAREST)

def shutter_encrypt(hex_msg, enc_meta):
    """Call the Shutter WebAssembly bundle via CLI bridge (simplest)"""
    # For demo we POST to a helper endpoint Shutter exposes (works for small payloads)
    r = requests.post(f"{SHUTTER_API_BASE}/encrypt_hex", json={
        "data": hex_msg,
        "identity":   enc_meta["identity"],
        "eon_key":    enc_meta["eon_key"]
    })
    r.raise_for_status()
    return r.json()["ciphertext"]

def upload_to_pinata(file_bytes, filename=None):
    """Upload file to Pinata IPFS using V3 or V2 API"""
    if not PINATA_ENABLED:
        raise Exception("Pinata not configured")
    
    if PINATA_VERSION == "v3":
        return upload_to_pinata_v3(file_bytes, filename)
    else:
        return upload_to_pinata_v2(file_bytes, filename)

def upload_to_pinata_v3(file_bytes, filename=None):
    """Upload file to Pinata IPFS using V3 API"""
    url = "https://uploads.pinata.cloud/v3/files"
    
    headers = {
        'Authorization': f'Bearer {PINATA_JWT}'
    }
    
    # Prepare the file data
    files = {
        'file': (filename or 'encrypted_data', file_bytes, 'application/octet-stream')
    }
    
    # Add form data to make the file publicly accessible on IPFS
    data = {
        'network': 'public',  # This is the key - makes files publicly accessible
        'name': filename or 'encrypted_data',
        'keyvalues': json.dumps({
            'type': 'time_capsule_encrypted_image',
            'uploaded_at': str(int(time.time()))
        })
    }    
    try:
        print(f"Uploading {len(file_bytes)} bytes to Pinata V3 API (public network)...")
        response = requests.post(url, files=files, data=data, headers=headers)
        print(f"Pinata V3 response status: {response.status_code}")
        print(f"Pinata V3 response: {response.text}")
        response.raise_for_status()
        result = response.json()
        cid = result['data']['cid']
        
        # Verify the file is publicly accessible
        print(f"File uploaded to public IPFS with CID: {cid}")
        print(f"Public URL: https://gateway.pinata.cloud/ipfs/{cid}")
        
        return cid
    except requests.exceptions.RequestException as e:
        print(f"Pinata V3 upload failed: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Response status: {e.response.status_code}")
            print(f"Response text: {e.response.text}")
        raise Exception(f"Pinata V3 upload failed: {str(e)}")

def upload_to_pinata_v2(file_bytes, filename=None):
    """Upload file to Pinata IPFS using V2 API (legacy)"""
    url = "https://api.pinata.cloud/pinning/pinFileToIPFS"
    
    headers = {
        'pinata_api_key': PINATA_API_KEY,
        'pinata_secret_api_key': PINATA_SECRET_API_KEY
    }
    
    # Prepare the file data
    files = {
        'file': (filename or 'encrypted_data', file_bytes, 'application/octet-stream')
    }
    
    # Optional metadata
    pinata_options = {
        'cidVersion': 1,
    }
    
    data = {
        'pinataOptions': json.dumps(pinata_options)
    }
    
    try:
        print(f"Uploading {len(file_bytes)} bytes to Pinata V2 API...")
        response = requests.post(url, files=files, data=data, headers=headers)
        
        # Debug response
        print(f"Pinata V2 response status: {response.status_code}")
        print(f"Pinata V2 response headers: {dict(response.headers)}")
        
        if response.status_code != 200:
            print(f"Pinata V2 response text: {response.text}")
        
        response.raise_for_status()
        result = response.json()
        print(f"Successfully uploaded to Pinata V2: {result['IpfsHash']}")
        return result['IpfsHash']
    except requests.exceptions.RequestException as e:
        print(f"Pinata V2 upload failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response content: {e.response.text}")
        raise Exception(f"Pinata V2 upload failed: {str(e)}")

def get_pinata_gateway_url(cid):
    """Get the gateway URL for a Pinata IPFS file"""
    if PINATA_GATEWAY:
        return f"{PINATA_GATEWAY}/ipfs/{cid}"
    else:
        return f"https://gateway.pinata.cloud/ipfs/{cid}"

# ---------- routes ----------
@app.route("/health")
def health():
    return {"ok": True, "ts": int(time.time())}

@app.route("/system_info")
def system_info():
    """Return system configuration information"""
    return jsonify({
        "pinata_enabled": PINATA_ENABLED,
        "pinata_version": PINATA_VERSION,
        "pinata_gateway": PINATA_GATEWAY or "https://gateway.pinata.cloud",
        "local_server": "http://localhost:5000",
        "timestamp": int(time.time())
    })

@app.route("/submit_capsule", methods=["POST"])
def submit_capsule():
    try:
        title = request.form.get("title", "").strip()
        tags  = request.form.get("tags", "").strip()
        story = request.form.get("story", "").strip()
        img   = request.files.get("image")
        if not all([title, tags, story, img]):
            return {"error": "Missing field"}, 400

        # 1) pixelated preview
        pil = Image.open(img.stream)
        pixelated = pixelate(pil)
        buf = io.BytesIO()
        pixelated.save(buf, format="PNG")
        preview_b64 = base64.b64encode(buf.getvalue()).decode()

        # Use a random hex string as the preview filename
        preview_id = secrets.token_hex(16)
        pixelated_dir = "pixelated"
        os.makedirs(pixelated_dir, exist_ok=True)
        pixelated_path = os.path.join(pixelated_dir, f"{preview_id}.png")
        pixelated.save(pixelated_path, format="PNG")

        # 2) Register Shutter identity
        reveal_ts = int(request.form.get("revealTimestamp") or time.time() + 30)
        identity_prefix = os.urandom(32).hex()
        reg_resp = requests.post(f"{SHUTTER_API_BASE}/register_identity", json={
            "decryptionTimestamp": reveal_ts,
            "identityPrefix": identity_prefix,
            "registry": SHUTTER_REGISTRY
        })
        reg_json = reg_resp.json()
        if "message" not in reg_json:
            print("Unexpected Shutter API response:", reg_json)
            return {"error": "Shutter API did not return expected data"}, 502
        reg = reg_json["message"]

        # 3) Fetch encryption data
        enc_meta_resp = requests.get(
            f"{SHUTTER_API_BASE}/get_data_for_encryption",
            params={"address": SHUTTER_REGISTRY, "identityPrefix": reg["identity_prefix"]}
        )
        enc_meta_json = enc_meta_resp.json()
        if "message" not in enc_meta_json:
            print("Unexpected get_data_for_encryption response:", enc_meta_json)
            return {"error": "Shutter API did not return encryption data"}, 502
        enc_meta = enc_meta_json["message"]

        # 4) Return all info to frontend for client-side encryption
        return jsonify({
            "shutterIdentity":  reg["identity"],
            "identityPrefix":   reg["identity_prefix"],
            "eonKey":           reg["eon_key"],
            "revealTimestamp":  reveal_ts,
            "encMeta":          enc_meta,
            "pixelatedImage":  f"data:image/png;base64,{preview_b64}",
            "pixelatedId": preview_id  # <-- return the preview id if you want to reference it
        })
    except Exception as e:
        print("Error in /submit_capsule:", e)
        return {"error": str(e)}, 500

@app.route("/upload_ipfs", methods=["POST"])
def upload_ipfs():
    try:
        data = request.json
        hex_data = data.get("hex")
        if not hex_data or not hex_data.startswith("0x"):
            return {"error": "Missing or invalid hex data"}, 400
        
        # Convert hex string to bytes
        file_bytes = bytes.fromhex(hex_data[2:])
        
        # Generate a deterministic CID-like hash for the content (for local storage)
        content_hash = hashlib.sha256(file_bytes).hexdigest()
        local_cid = f"Qm{content_hash[:44]}"  # Simulate IPFS CID format
        
        # Store the file locally with the CID as filename (fallback)
        ipfs_dir = "ipfs_storage"
        os.makedirs(ipfs_dir, exist_ok=True)
        file_path = os.path.join(ipfs_dir, local_cid)
        
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        
        result = {
            "cid": local_cid,
            "local_url": f"http://localhost:5000/ipfs/{local_cid}",
            "pinata_enabled": PINATA_ENABLED
        }
          # Try to upload to Pinata IPFS if configured
        if PINATA_ENABLED:
            try:
                print("Uploading to Pinata IPFS...")
                pinata_cid = upload_to_pinata(file_bytes)
                pinata_url = get_pinata_gateway_url(pinata_cid)
                
                # Also store the file locally with the Pinata CID for faster access
                pinata_file_path = os.path.join(ipfs_dir, pinata_cid)
                with open(pinata_file_path, "wb") as f:
                    f.write(file_bytes)
                
                result.update({
                    "pinata_cid": pinata_cid,
                    "pinata_url": pinata_url,
                    "ipfs_urls": [pinata_url, f"http://localhost:5000/ipfs/{pinata_cid}"]
                })
                print(f"Successfully uploaded to Pinata: {pinata_cid}")
                
                # Use Pinata CID as primary CID if upload successful
                result["cid"] = pinata_cid
                
            except Exception as e:
                print(f"Pinata upload failed, using local storage only: {e}")
                result.update({
                    "pinata_error": str(e),
                    "ipfs_urls": [f"http://localhost:5000/ipfs/{local_cid}"]
                })
        else:
            result["ipfs_urls"] = [f"http://localhost:5000/ipfs/{local_cid}"]
            
        return jsonify(result)
        
    except Exception as e:
        print("Error in /upload_ipfs:", e)
        return {"error": str(e)}, 500

@app.route("/pixelated/<cid>")
def pixelated(cid):
    # Example: store pixelated previews in ./pixelated/<cid>.png
    path = os.path.join("pixelated", f"{cid}.png")
    print(f"Pixelated request for CID: {cid}, looking for file: {path}")
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return "Not found", 404
    print(f"Serving pixelated file: {path}")
    try:
        # Read file and return with proper headers for images
        with open(path, 'rb') as f:
            file_data = f.read()
        return file_data, 200, {'Content-Type': 'image/png'}
    except Exception as e:
        print(f"Error serving pixelated file: {e}")
        return "Error reading file", 500

@app.route("/ipfs/<cid>")
def serve_ipfs(cid):
    # Serve files from local IPFS storage
    path = os.path.join("ipfs_storage", cid)
    print(f"IPFS request for CID: {cid}, looking for file: {path}")
    if not os.path.exists(path):
        print(f"IPFS file not found locally: {path}")
        
        # If Pinata is enabled, try to fetch from Pinata gateway
        if PINATA_ENABLED:
            try:
                print(f"Attempting to fetch from Pinata gateway: {cid}")
                pinata_url = get_pinata_gateway_url(cid)
                response = requests.get(pinata_url, timeout=10)
                response.raise_for_status()
                
                # Cache the file locally for future requests
                os.makedirs("ipfs_storage", exist_ok=True)
                with open(path, 'wb') as f:
                    f.write(response.content)
                print(f"Successfully fetched and cached from Pinata: {cid}")
                
                return response.content, 200, {'Content-Type': 'application/octet-stream'}
            except Exception as e:
                print(f"Failed to fetch from Pinata: {e}")
        
        return "Not found", 404
    
    print(f"Serving IPFS file: {path}")
    try:
        # Read file and return with proper headers
        with open(path, 'rb') as f:
            file_data = f.read()
        return file_data, 200, {'Content-Type': 'application/octet-stream'}
    except Exception as e:
        print(f"Error serving IPFS file: {e}")
        return "Error reading file", 500

@app.route("/save_pixelated", methods=["POST"])
def save_pixelated():
    try:
        data = request.json
        cid = data.get("cid")
        preview_id = data.get("preview_id")
        print(f"save_pixelated called with cid={cid}, preview_id={preview_id}")
        if not cid or not preview_id:
            return {"error": "Missing cid or preview_id"}, 400
        src = os.path.join("pixelated", f"{preview_id}.png")
        dst = os.path.join("pixelated", f"{cid}.png")
        print(f"Renaming {src} to {dst}")
        if not os.path.exists(src):
            print(f"Source file {src} does not exist")
            return {"error": "Preview not found"}, 404
        os.rename(src, dst)
        print(f"Successfully renamed {src} to {dst}")
        return {"ok": True}
    except Exception as e:
        print("Error in /save_pixelated:", e)
        return {"error": str(e)}, 500

# ---------- static SPA ----------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

if __name__ == "__main__":
    print("🚀  backend on http://127.0.0.1:5000")
    app.run(debug=True)
