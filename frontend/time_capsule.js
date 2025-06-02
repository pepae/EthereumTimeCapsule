/*  time_capsule.js — ESM module  */
/*  Requires:
      - ethers 5.7+
      - axios
      - buffer (polyfill)
      - wallet-connect provider for mobile
      - Shutter web bundle (loads `window.shutter`)
*/

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios      from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;


// =============  GLOBALS  =============
let provider, signer, contract, contractRead;
let contractAddr, contractAbi, shutterApi, registryAddr;
let capsuleOffset = 0;
const batch = 5;

// =============  HELPERS  =============
const $ = (id)=>document.getElementById(id);
const setStatus = (m)=>{ console.log(m); $("status").textContent = m; };
const fmtTime   = (ts)=>new Date(ts*1000).toLocaleString();
const ipfsURL   = (cid)=>`http://localhost:5000/ipfs/${cid}`; // Use local backend instead of public gateway

// =============  WALLET CONNECT  =============
let walletConnected = false;

async function connectWallet(manual = false){
  try {
    let eth = window.ethereum;
    if(!eth){
      // fallback to WalletConnect
      const wc = new WalletConnectProvider({
        rpc:{100:"https://rpc.gnosischain.com"},
        chainId:100
      });
      await wc.enable();
      eth = wc;
    } else if (manual) {
      // Prompt MetaMask connect if manual
      await eth.request({ method: "eth_requestAccounts" });
    }
    provider = new ethers.providers.Web3Provider(eth);
    signer   = provider.getSigner();
    const net= await provider.getNetwork();
    if(net.chainId!==100) throw new Error("Please switch to Gnosis Chain (100)");
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    setStatus("Wallet connected");
    walletConnected = true;
  } catch(e) {
    setStatus("Wallet connection failed: " + e.message);
    walletConnected = false;
  }
}

// =============  BACKEND CALL  =============
async function requestCapsuleEncryption(title, tags, story, file) {
  // Always set reveal timestamp 60 seconds in the future
  const revealTimestamp = Math.floor(Date.now() / 1000) + 60;

  const fd = new FormData();
  fd.append("title", title);
  fd.append("tags", tags);
  fd.append("story", story);
  fd.append("image", file);
  fd.append("revealTimestamp", revealTimestamp); // Pass to backend

  const r = await axios.post("http://localhost:5000/submit_capsule", fd, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return r.data; // {encryptedStory, shutterIdentity, revealTimestamp, imageCID, pixelatedImage}
}

// Helper: convert file to hex string
async function fileToHex(file) {
  const arrayBuffer = await file.arrayBuffer();
  return "0x" + Array.from(new Uint8Array(arrayBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper: upload to IPFS via backend (or use a public IPFS API)
async function uploadToIPFS(hexData) {
  // Example: POST to your backend /upload_ipfs endpoint (implement this if needed)
  const res = await axios.post("http://localhost:5000/upload_ipfs", { hex: hexData });
  return res.data.cid;
}

// Wait for Shutter WASM to be ready
async function ensureShutterReady() {
  let tries = 0;
  while (
    (!window.shutter || typeof window.shutter.encryptData !== "function") &&
    tries < 100
  ) {
    await new Promise(res => setTimeout(res, 50));
    tries++;
  }
  if (!window.shutter || typeof window.shutter.encryptData !== "function") {
    throw new Error("Shutter WASM not loaded!");
  }
}

// =============  CREATE  =============
async function createCapsule() {
  try {
    const title = $("capTitle").value.trim();
    const tags  = $("capTags").value.trim();
    const story = $("capStory").value.trim();
    const file  = $("capImage").files[0];
    if (!title || !tags || !story || !file) return setStatus("Fill in every field & choose an image");

    setStatus("Preparing Shutter encryption…");
    // 1. Get Shutter identity, encMeta, and pixelated preview from backend
    const enc = await requestCapsuleEncryption(title, tags, story, file);

    // 2. Wait for Shutter WASM to be ready
    await ensureShutterReady();

    // 3. Encrypt story using Shutter WASM/SDK (MATCH WORKING APP)
    // Use Buffer.from(story, "utf8").toString("hex") for hex encoding
    const storyHex = "0x" + Buffer.from(story, "utf8").toString("hex");
    // Generate random sigma (32 bytes) for encryption - this is required for Shutter encryption
    const sigmaBytes = new Uint8Array(32);
    crypto.getRandomValues(sigmaBytes);
    const sigmaHex = "0x" + Array.from(sigmaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    // Use enc.shutterIdentity and enc.encMeta.eon_key for encryption (identity must match decryption fetch)
    console.log("Encrypting with:", {
      storyHex,
      identity: enc.shutterIdentity,
      eon_key: enc.encMeta.eon_key,
      sigmaHex
    });
    const encryptedStory = await window.shutter.encryptData(
      storyHex,
      enc.shutterIdentity, // use the same identity as stored in contract and used for decryption
      enc.encMeta.eon_key,
      sigmaHex
    );    // 4. Encrypt image file as hex string (consistent with story encryption)
    const imgHex = await fileToHex(file);
    const encryptedImg = await window.shutter.encryptData(
      imgHex,
      enc.shutterIdentity, // use the same identity for consistency
      enc.encMeta.eon_key,
      sigmaHex
    );

    // 5. Upload encrypted image to IPFS
    setStatus("Uploading encrypted image to IPFS…");
    const imageCID = await uploadToIPFS(encryptedImg);

    // Save pixelated image CID mapping on backend
    await axios.post("http://localhost:5000/save_pixelated", {
      cid: imageCID,
      preview_id: enc.pixelatedId
    });

    setStatus("Sending tx…");
    // STORE ENCRYPTED STORY AS BYTES (arrayify hex string)
    const tx = await contract.commitCapsule(
      title,
      tags,
      ethers.utils.arrayify(encryptedStory), // convert hex string to bytes for contract
      enc.revealTimestamp,
      enc.shutterIdentity,
      imageCID
    );
    await tx.wait();
    setStatus("Capsule committed! Tx hash: " + tx.hash);

    // quick UI preview
    $("previewList").insertAdjacentHTML("afterbegin", `
      <div class="capsule-card unrevealed">
        <h3>${title}</h3>
        <img src="${enc.pixelatedImage}" alt="pixelated preview">
        <p><em>Will unlock on ${fmtTime(enc.revealTimestamp)}</em></p>
      </div>`);

    $("capForm").reset();
  } catch (e) {
    console.error(e);
    setStatus(e.message);
  }
}

// =============  DECRYPT ONLY (NO TX)  =============
async function decryptCapsule(id, shutterIdentity) {
  try {
    setStatus("Fetching decryption key from Shutter…");
    const resp = await axios.get(`${shutterApi}/get_decryption_key`, {
      params: { identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if (!key) {
      setStatus("Decryption key not available yet! Please wait a bit and try again.");
      return;
    }

    setStatus("Fetching capsule data…");
    const cap = await contractRead.getCapsule(id);

    setStatus("Decrypting story…");
    // --- Robust handling for encryptedStory format ---
    let encryptedHex;
    if (typeof cap.encryptedStory === "string" && cap.encryptedStory.startsWith("0x")) {
      encryptedHex = cap.encryptedStory;
    } else if (cap.encryptedStory instanceof Uint8Array || Array.isArray(cap.encryptedStory)) {
      encryptedHex = ethers.utils.hexlify(cap.encryptedStory);
    } else if (cap.encryptedStory._isBuffer) {
      encryptedHex = ethers.utils.hexlify(Uint8Array.from(cap.encryptedStory));
    } else {
      throw new Error("Unknown encryptedStory format");
    }
    console.log("Decrypting with:", { encryptedHex, key });
    // --- Try decryption, fallback to direct string if error ---
    let plaintext;
    try {
      const plaintextHex = await window.shutter.decrypt(
        encryptedHex,
        key
      );
      plaintext = Buffer.from(plaintextHex.slice(2), "hex").toString("utf8");
    } catch (err) {
      // If padding error, try to decode as utf8 directly (for debugging)
      console.error("Decryption error, trying fallback:", err);
      try {
        plaintext = Buffer.from(encryptedHex.slice(2), "hex").toString("utf8");
      } catch (fallbackErr) {
        plaintext = "[Decryption failed: " + err.message + "]";
      }
    }    // Find the correct capsule card by searching for the ID in the summary text
    const allCapsules = document.querySelectorAll('.capsule-card');
    let targetCapsule = null;
    
    for (const capsule of allCapsules) {
      const summary = capsule.querySelector('summary');
      if (summary && summary.textContent.includes(`ID #${id}`)) {
        targetCapsule = capsule;
        break;
      }
    }
    
    if (targetCapsule) {
      let out = targetCapsule.querySelector('.decrypted-story');
      if (!out) {
        out = document.createElement('div');
        out.className = 'decrypted-story';
        targetCapsule.querySelector('div').appendChild(out);
      }
      out.innerHTML = `<pre>${plaintext}</pre>`;
      console.log(`Successfully displayed decrypted text for capsule #${id}`);
    } else {
      console.error(`Could not find capsule card for ID #${id}`);
    }
    setStatus("Decryption complete!");
  } catch (e) {
    if (e.response && (e.response.status === 400 || e.response.status === 404)) {
      setStatus("Decryption key not available yet! Please wait a bit and try again.");
    } else {
      console.error(e);
      setStatus("Decryption failed: " + e.message);
    }
  }
}

// =============  LOAD CAPSULES  =============
async function loadCapsules(){
  try{
    const total = (await contractRead.capsuleCount()).toNumber();
    if(capsuleOffset>=total) return setStatus("No more capsules");
    const container = $("capsuleList");

    for(let i=0;i<batch && (capsuleOffset+i)<total;i++){
      const id = capsuleOffset+i;
      const c  = await contractRead.getCapsule(id);      const revealed = c.isRevealed;
      const imgSrc = revealed ? ipfsURL(c.imageCID) : `http://localhost:5000/pixelated/${c.imageCID}`; // backend helper for pixelated others
      container.insertAdjacentHTML("beforeend",`
        <details class="capsule-card ${revealed?'revealed':'unrevealed'}">
          <summary>
            <strong>${c.title}</strong> — ID #${id}
            ${revealed ? "(revealed)" : "(locked)"}
          </summary>
          <div>
            <img src="${imgSrc}" alt="preview">
            <p><strong>Tags:</strong> ${c.tags}</p>
            <p><strong>Creator:</strong> ${c.creator}</p>
            <p><strong>Unlocks at:</strong> ${fmtTime(c.revealTime)}</p>
            ${revealed
              ? `<pre>${c.decryptedStory}</pre>`
              : `<button onclick="revealCapsule(${id},'${c.shutterIdentity}')">Attempt manual reveal</button>
                 <button onclick="decryptCapsule(${id},'${c.shutterIdentity}')">Decrypt (view only)</button>
                 <div class="decrypted-story"></div>`
            }
          </div>
        </details>
      `);
    }
    capsuleOffset += batch;
  }catch(e){ console.error(e); setStatus("Load error: "+e.message); }
}

// =============  REVEAL  =============
async function revealCapsule(id,shutterIdentity){
  try{
    setStatus("Checking key…");
    const resp = await axios.get(`${shutterApi}/get_decryption_key`,{
      params:{ identity: shutterIdentity, registry: registryAddr }
    });
    const key = resp.data?.message?.decryption_key;
    if(!key) return setStatus("Key not out yet!");

    const cap = await contractRead.getCapsule(id);
    const plaintextHex = await window.shutter.decrypt( ethers.utils.hexlify(cap.encryptedStory), key );
    const plaintext = Buffer.from(plaintextHex.slice(2),"hex").toString("utf8");

    setStatus("Sending reveal tx…");
    const tx = await contract.revealCapsule(id, plaintext);
    await tx.wait();
    setStatus("Revealed! Tx: "+tx.hash);
  }catch(e){ console.error(e); setStatus(e.message); }
}

// =============  NETWORK SWITCH FLAG  =============
// Set this flag to "testnet" or "mainnet" to switch Shutter network
const NETWORK = "testnet"; // or "mainnet"

// =============  INIT  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {
    // load configs & ABI
    const cfgAll = await (await fetch("public_config.json")).json();

    // Always use the default_network for contract address and provider
    const fixedNetwork = cfgAll.default_network;
    const fixedCfg = cfgAll[fixedNetwork];

    // Use the flag only for Shutter API and registry address
    const shutterCfg = cfgAll[NETWORK];

    contractAddr = fixedCfg.contract_address;
    contractAbi  = await (await fetch("contract_abi.json")).json();
    shutterApi   = shutterCfg.shutter_api_base;
    registryAddr = shutterCfg.registry_address;

    // read-only provider (fixed)
    contractRead = new ethers.Contract(
      contractAddr,
      contractAbi,
      new ethers.providers.JsonRpcProvider(fixedCfg.rpc_url)
    );

    // wallet (transactions)
    await connectWallet();

    // button wire-up
    $("createCapsule-btn").onclick = createCapsule;
    $("loadMore-btn").onclick      = loadCapsules;
    $("connectWallet-btn").onclick = async () => {
      await connectWallet(true);
    };

    try { await connectWallet(); } catch {}

    loadCapsules();
  } catch (e) { console.error(e); setStatus(e.message); }
});

// ===== expose to window for inline buttons =====
window.revealCapsule = revealCapsule;
window.decryptCapsule = decryptCapsule;

/*  <script type="module" src="main.js"></script>
<script type="module" src="time_capsule.js"></script>  */
