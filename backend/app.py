import os, io, time, base64, json
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PIL import Image
import requests, ipfshttpclient
import secrets

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

# ---------- routes ----------
@app.route("/health")
def health():
    return {"ok": True, "ts": int(time.time())}

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
        # Connect to local IPFS node
        client = ipfshttpclient.connect("/ip4/127.0.0.1/tcp/5001")
        cid = client.add_bytes(file_bytes)
        client.close()
        return jsonify({"cid": cid})
    except Exception as e:
        print("Error in /upload_ipfs:", e)
        return {"error": str(e)}, 500

@app.route("/pixelated/<cid>")
def pixelated(cid):
    # Example: store pixelated previews in ./pixelated/<cid>.png
    path = os.path.join("pixelated", f"{cid}.png")
    if not os.path.exists(path):
        return "Not found", 404
    return send_from_directory("pixelated", f"{cid}.png")

@app.route("/save_pixelated", methods=["POST"])
def save_pixelated():
    try:
        data = request.json
        cid = data.get("cid")
        preview_id = data.get("preview_id")
        if not cid or not preview_id:
            return {"error": "Missing cid or preview_id"}, 400
        src = os.path.join("pixelated", f"{preview_id}.png")
        dst = os.path.join("pixelated", f"{cid}.png")
        if not os.path.exists(src):
            return {"error": "Preview not found"}, 404
        os.rename(src, dst)
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
