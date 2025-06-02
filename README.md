## Ethereum Time Capsule

*Shutter-encrypted commit-and-reveal DApp on Gnosis Chain*

---

### Table of Contents

1. [Overview](#overview)
2. [High-level Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Smart-contract Deployment](#smart-contract-deployment)
7. [Backend (Flask API)](#backend)
8. [Frontend (DApp)](#frontend)
9. [Environment & Config Files](#config)
10. [Typical Workflow](#workflow)
11. [Testing with Short Reveal Windows](#test-mode)
12. [Production Checklist](#production)
13. [Troubleshooting](#troubleshooting)
14. [Security & Privacy Notes](#security)
15. [License](#license)

---

<a name="overview"></a>

### 1. Overview

Ethereum Time Capsule lets anyone lock an image and a story on-chain for exactly one year.

* **Plain-text fields:** title & tags (immediately public).
* **Secret fields:** story text + image; both threshold-encrypted via **Shutter Network**.
* **Storage:**

  * Encrypted story → on-chain (bytes) in the `TimeCapsule` contract.
  * Encrypted image → off-chain on **IPFS**; only its CID is stored on-chain.
  * A pixelated preview is generated server-side for UX.
* **Reveal:** When Shutter’s keyper network publishes the decryption key (1 year later), anyone calls `revealCapsule(id, plaintext)`; the story becomes permanent public data on the contract.

The result is a censorship-resistant, provably time-locked “digital bottle in the blockchain sea”.

---

<a name="architecture"></a>

### 2. High-level Architecture

```
┌───────────────┐   submitCapsule()   ┌───────────────────┐
│  DApp (React) │ ───────────────────▶│   Flask backend   │
└───────────────┘  (multipart + JSON) └───────────────────┘
        │                                      │
        │ ethers.js tx                         │ Pillow pixelate
        ▼                                      │ Shutter encrypt
┌───────────────────┐       event              │ IPFS add (CID)
│ TimeCapsule.sol   │◀───────────────┐         │
│  (Gnosis Chain)   │                │         ▼
└───────────────────┘                │  ┌─────────────┐
        ▲                            └──│  IPFS pin   │
        │   revealCapsule()              └─────────────┘
        │
        │ after 1 year & Shutter key
        ▼
┌───────────────┐
│  Public data  │
└───────────────┘
```

---

<a name="tech-stack"></a>

### 3. Tech Stack

| Layer                    | Tooling                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Smart Contract**       | Solidity ^0.8 • OpenZeppelin utils (optional)                                                                      |
| **Chain**                | Gnosis Chain (ID 100)                                                                                              |
| **Threshold Encryption** | Shutter Network public REST API                                                                                    |
| **Backend**              | Python 3.10+ • Flask 2.x • Pillow • `ipfshttpclient`                                                               |
| **Storage**              | Local IPFS daemon <br> *(or pin-service such as Pinata/web3.storage)*                                              |
| **Frontend**             | Vanilla HTML • small inline CSS • `time_capsule.js` (ES Modules) <br> Ethers 5 ESM • WalletConnect 1.x UMD • axios |
| **Build / Test**         | Hardhat for Solidity; any static server for frontend                                                               |

---

<a name="project-structure"></a>

### 4. Project Structure

```
root/
├─ backend/
│  └─ app.py                 # Flask routes
├─ frontend/
│  ├─ index.html             # minimal UI
│  ├─ time_capsule.js        # DApp logic
│  ├─ public_config.json     # chain + API endpoints
│  └─ contract_abi.json      # ABI fragment
├─ contracts/
│  └─ TimeCapsule.sol
├─ scripts/
│  └─ deploy.js              # hardhat deploy helper
├─ requirements.txt
└─ README.md
```

---

<a name="prerequisites"></a>

### 5. Prerequisites

| Tool                                           | Minimum Version | Notes                      |
| ---------------------------------------------- | --------------- | -------------------------- |
| **Node.js**                                    | 18.x            | for Hardhat & frontend dev |
| **Python**                                     | 3.10            | backend                    |
| **pip**                                        | 23+             | newer PEP-517 resolution   |
| **ipfs daemon**                                | 0.21            | `ipfs daemon --init`       |
| **MetaMask / WalletConnect-compatible wallet** | —               | on Gnosis Chain            |

---

<a name="smart-contract-deployment"></a>

### 6. Smart-contract Deployment

1. `cd contracts && npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers`
2. Add a Hardhat network for Gnosis:

   ```js
   networks:{ gnosis:{ url:"https://rpc.gnosischain.com", accounts:[process.env.DEPLOYER_PK] } }
   ```
3. Compile & deploy:

   ```bash
   npx hardhat compile
   npx hardhat run scripts/deploy.js --network gnosis
   ```

   `deploy.js` should simply:

   ```js
   const TimeCapsule = await ethers.getContractFactory("TimeCapsule");
   const tc = await TimeCapsule.deploy();
   console.log("TimeCapsule:", tc.address);
   ```
4. Copy the address into `frontend/public_config.json → contract_address`.

---

<a name="backend"></a>

### 7. Backend (Flask API)

```bash
python -m venv venv
venv\Scripts\activate         # Windows
# or source venv/bin/activate
pip install -r requirements.txt
ipfs daemon --init            # new terminal
python backend/app.py         # default http://127.0.0.1:5000
```

Key endpoints:

| Route             | Method                     | Purpose                                                                                   |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `/submit_capsule` | `POST multipart/form-data` | Receives title, tags, story, image → pixelate ⇢ Shutter encrypt ⇢ IPFS add ⇢ returns JSON |

The app expects a local IPFS daemon at `/ip4/127.0.0.1/tcp/5001`.
If you use a pin-service, swap out `client.add_bytes` for their SDK.

---

<a name="frontend"></a>

### 8. Frontend (DApp)

Serve `frontend/` with any static server:

```bash
cd frontend
python -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) then:

1. Connect wallet (MetaMask on desktop; WalletConnect QR on mobile).
2. Fill the form → **Create Capsule**. Wallet pops up to sign `commitCapsule`.
3. Click **Load more** to fetch on-chain data via public RPC.
4. After the reveal date, click **Attempt manual reveal** (or let a cron job reveal automatically).

---

<a name="config"></a>

### 9. Environment & Config Files

`frontend/public_config.json`

```json
{
  "contract_address"   : "0x...",        // TimeCapsule.sol
  "registry_address"   : "0x...",        // Shutter registry/keyper
  "shutter_api_base"   : "https://api.shutter.network",
  "rpc_url"            : "https://rpc.gnosischain.com"
}
```

`backend/.env` (optional)

```bash
# If you pin via an IPFS pin-service
PINATA_JWT="Bearer eyJ...etc"
```

---

<a name="workflow"></a>

### 10. Typical Workflow

| Step                 | What Happens                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User submits**     | Form POST to Flask                                                                                                                                                                                                      |
| Flask                | *Pixelate image* → `Pillow` <br> *Register identity* → `POST /register_identity` (Shutter) <br> *Encrypt* → `GET /get_data_for_encryption` + `window.shutter.encryptData` <br> *IPFS add* encrypted image → returns CID |
| Flask → Frontend     | JSON `{ encryptedStory, imageCID, shutterIdentity, revealTimestamp, pixelatedImage }`                                                                                                                                   |
| Frontend             | `commitCapsule(title, tags, bytes, timestamp, identity, CID)`                                                                                                                                                           |
| ↳ **One year later** | DApp/cron calls `GET /get_decryption_key`, decrypts story, sends `revealCapsule()`                                                                                                                                      |

---

<a name="test-mode"></a>

### 11. Testing with Short Reveal Windows

For local demos set the reveal time to e.g. **+5 minutes** instead of +1 year when calling `/register_identity`.
Everything else stays the same; you can witness the full lifecycle within minutes.

---

<a name="production"></a>

### 12. Production Checklist

* [ ] Host IPFS node in a persistent instance or use paid pinning.
* [ ] Enforce HTTPS for Flask + static assets.
* [ ] Rate-limit `/submit_capsule` to prevent spam & large-image DoS.
* [ ] Store AES-encrypted image instead of raw bytes for very large uploads (threshold-encrypt AES key only).
* [ ] Set CORS rules if frontend served from a different origin.
* [ ] Monitor Shutter key-release schedule; run a cloud function that auto-reveals capsules on-chain.
* [ ] Verify story integrity by storing a hash at commit time (optional advanced feature).

---

<a name="troubleshooting"></a>

### 13. Troubleshooting

| Symptom                             | Fix                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `varint` build error                | `pip install backports.tarfile` then reinstall (`varint` needs it).                             |
| “Decryption key not available yet!” | Either the reveal time hasn’t passed, or Shutter keyper is still catching up. Re-query later.   |
| Wrong chain ID in MetaMask          | The DApp auto-suggests Gnosis Chain; accept the prompt, or add network manually (chainId 0x64). |
| IPFS CID shows “not found”          | Your local node hasn’t finished pinning; wait or pin remotely.                                  |

---

<a name="security"></a>

### 14. Security & Privacy Notes

* **No immutable deletion** – once revealed, the story is forever on-chain; advise users not to post private data.
* **JPEG EXIF leaks** – the backend currently encrypts the raw file; if the image contained GPS EXIF, it’s still there after decrypt. Consider stripping EXIF before encryption.
* **Backend runs key generation** – although the story encryption is threshold-based, the server still sees plaintext before encryption. If you need full client-side secrecy, port the Shutter encryption flow to the browser (WebAssembly) and ship only ciphertext to the backend for IPFS upload.
* **DoS protection** – limit image size (<10 MB) to avoid bloating IPFS and Shutter payloads.

---

<a name="license"></a>

### 15. License

`TimeCapsule.sol`, backend, and frontend code are released under **MIT** unless noted otherwise.
The bundled Shutter crypto library is © Shutter Network and distributed under its own permissive license.

---

### Enjoy your voyage through time!

PRs and issues are welcome. 🎈
