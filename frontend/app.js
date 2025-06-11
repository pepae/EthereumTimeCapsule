/*  app.js — Main Application Router  */
/*  Handles navigation between different steps of capsule creation  */

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.esm.min.js";
import axios from "https://cdn.skypack.dev/axios";
import { Buffer } from "https://esm.sh/buffer";

// UMD bundle already loaded, grab default export:
const WalletConnectProvider = window.WalletConnectProvider.default;

// =============  GLOBALS  =============
let provider, signer, contract, contractRead;
let contractAddr, contractAbi, shutterApi, registryAddr;
let walletConnected = false;

// Application state for capsule creation flow
let capsuleData = {
  title: '',
  tags: '',
  story: '',
  image: null,
  encryptionData: null,
  txHash: null,
  capsuleId: null
};

// Current step in the flow
let currentStep = 1;

// =============  NAVIGATION  =============
function showStep(step) {
  // Hide all step containers
  document.querySelectorAll('.step-container').forEach(el => {
    el.classList.remove('active');
  });
  
  // Show current step
  const stepElement = document.getElementById(`step-${step}`);
  if (stepElement) {
    stepElement.classList.add('active');
    currentStep = step;
    
    // Update progress indicator
    updateProgressIndicator(step);
    
    // Update step title for steps 2-5
    updateStepTitle(step);
  }
}

function updateProgressIndicator(step) {
  document.querySelectorAll('.progress-step').forEach((el, index) => {
    const stepNumber = index + 1;
    if (stepNumber < step) {
      el.classList.add('completed');
      el.classList.remove('active');
    } else if (stepNumber === step) {
      el.classList.add('active');
      el.classList.remove('completed');
    } else {
      el.classList.remove('active', 'completed');
    }
  });
}

function updateStepTitle(step) {
  // Update the main progress section title for steps 2-5
  const progressSection = document.querySelector('.progress-section .step-title');
  if (progressSection && step > 1) {
    const stepTexts = {
      2: { number: 'Step 2', description: 'Preview Your Entry' },
      3: { number: 'Step 3', description: 'Encrypt Your Entry' },
      4: { number: 'Step 4', description: 'Submit to Blockchain' },
      5: { number: 'Step 5', description: 'Complete!' }
    };
    
    if (stepTexts[step]) {
      const numberText = progressSection.querySelector('.step-number-text');
      const descText = progressSection.querySelector('.step-description');
      if (numberText) numberText.textContent = stepTexts[step].number;
      if (descText) descText.textContent = stepTexts[step].description;
    }
  }
}

function nextStep() {
  if (currentStep < 5) {
    showStep(currentStep + 1);
  }
}

function prevStep() {
  if (currentStep > 1) {
    showStep(currentStep - 1);
  }
}

function goToStep(step) {
  showStep(step);
}

// =============  WALLET CONNECTION  =============
async function connectWallet(manual = false) {
  try {
    let eth = window.ethereum;
    if (!eth) {
      // fallback to WalletConnect
      const wc = new WalletConnectProvider({
        rpc: { 100: "https://rpc.gnosischain.com" },
        chainId: 100
      });
      await wc.enable();
      eth = wc;
    } else if (manual) {
      // Prompt MetaMask connect if manual
      await eth.request({ method: "eth_requestAccounts" });
    }
    
    provider = new ethers.providers.Web3Provider(eth);
    signer = provider.getSigner();
    
    const net = await provider.getNetwork();
    if (net.chainId !== 100) throw new Error("Please switch to Gnosis Chain (100)");
    
    // Initialize contract with signer for transactions
    contract = new ethers.Contract(contractAddr, contractAbi, signer);
    console.log("💰 Wallet contract initialized with address:", contractAddr);
    
    // Verify signer is working by getting address
    const signerAddress = await signer.getAddress();
    console.log("✅ Wallet connected, signer address:", signerAddress);
    
    walletConnected = true;
    updateWalletStatus(true);
    
    return true;
  } catch (e) {
    console.error("Wallet connection failed:", e);
    walletConnected = false;
    updateWalletStatus(false);
    return false;
  }
}

function updateWalletStatus(connected) {
  const walletStatus = document.getElementById('wallet-status');
  const walletButton = document.getElementById('connect-wallet-btn');
  
  if (connected) {
    if (walletStatus) {
      walletStatus.textContent = '✅ Wallet Connected';
      walletStatus.className = 'wallet-status connected';
    }
    if (walletButton) {
      walletButton.textContent = 'Connected';
      walletButton.disabled = true;
    }
  } else {
    if (walletStatus) {
      walletStatus.textContent = '❌ Wallet Not Connected';
      walletStatus.className = 'wallet-status disconnected';
    }
    if (walletButton) {
      walletButton.textContent = 'Connect';
      walletButton.disabled = false;
    }
  }
}

// =============  STEP 1: FILL ENTRY  =============
function validateStep1() {
  const title = document.getElementById('entry-title').value.trim();
  const tags = document.getElementById('entry-tags').value.trim();
  const story = document.getElementById('entry-story').value.trim();
  const image = document.getElementById('entry-image').files[0];
  
  if (!title || !tags || !story || !image) {
    alert('Please fill in all fields and select an image');
    return false;
  }
  
  // Save data
  capsuleData.title = title;
  capsuleData.tags = tags;
  capsuleData.story = story;
  capsuleData.image = image;
  
  return true;
}

function proceedFromStep1() {
  if (validateStep1()) {
    populatePreview();
    nextStep();
  }
}

// =============  STEP 2: PREVIEW  =============
function populatePreview() {
  document.getElementById('preview-title').textContent = capsuleData.title;
  document.getElementById('preview-tags').textContent = capsuleData.tags;
  document.getElementById('preview-story').textContent = capsuleData.story;
  
  // Show image preview
  if (capsuleData.image) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const previewImage = document.getElementById('preview-image');
      previewImage.src = e.target.result;
      previewImage.style.display = 'block';
    };
    reader.readAsDataURL(capsuleData.image);
  }
}

function editEntry() {
  prevStep(); // Go back to step 1
}

function confirmPreview() {
  nextStep(); // Go to encryption step
}

// =============  STEP 3: ENCRYPTION  =============
async function startEncryption() {
  try {
    document.getElementById('encryption-status').textContent = 'Preparing encryption...';
    document.getElementById('encryption-progress').style.width = '10%';
    
    // 1. Get Shutter identity and encryption metadata from backend
    document.getElementById('encryption-status').textContent = 'Getting encryption parameters...';
    const revealTimestamp = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
    
    const fd = new FormData();
    fd.append("title", capsuleData.title);
    fd.append("tags", capsuleData.tags);
    fd.append("story", capsuleData.story);
    fd.append("image", capsuleData.image);
    fd.append("revealTimestamp", revealTimestamp);
    
    const encResponse = await axios.post("http://localhost:5000/submit_capsule", fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    
    document.getElementById('encryption-progress').style.width = '30%';
    
    // 2. Wait for Shutter WASM to be ready
    document.getElementById('encryption-status').textContent = 'Initializing encryption engine...';
    await ensureShutterReady();
    
    document.getElementById('encryption-progress').style.width = '50%';
    
    // 3. Encrypt story
    document.getElementById('encryption-status').textContent = 'Encrypting story...';
    const storyHex = "0x" + Buffer.from(capsuleData.story, "utf8").toString("hex");
    const sigmaBytes = new Uint8Array(32);
    crypto.getRandomValues(sigmaBytes);
    const sigmaHex = "0x" + Array.from(sigmaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const encryptedStory = await window.shutter.encryptData(
      storyHex,
      encResponse.data.shutterIdentity,
      encResponse.data.encMeta.eon_key,
      sigmaHex
    );
    
    document.getElementById('encryption-progress').style.width = '70%';
    
    // 4. Encrypt image
    document.getElementById('encryption-status').textContent = 'Encrypting image...';
    const imgHex = await fileToHex(capsuleData.image);
    const encryptedImg = await window.shutter.encryptData(
      imgHex,
      encResponse.data.shutterIdentity,
      encResponse.data.encMeta.eon_key,
      sigmaHex
    );
    
    document.getElementById('encryption-progress').style.width = '85%';
    
    // 5. Upload to IPFS
    document.getElementById('encryption-status').textContent = 'Uploading to IPFS...';
    const uploadResult = await uploadToIPFS(encryptedImg);
    
    document.getElementById('encryption-progress').style.width = '95%';
    
    // Save encryption data
    capsuleData.encryptionData = {
      encryptedStory,
      shutterIdentity: encResponse.data.shutterIdentity,
      revealTimestamp: encResponse.data.revealTimestamp,
      imageCID: uploadResult.cid,
      pixelatedImage: encResponse.data.pixelatedImage,
      pixelatedId: encResponse.data.pixelatedId
    };
    
    // Save pixelated mapping
    await axios.post("http://localhost:5000/save_pixelated", {
      cid: uploadResult.cid,
      preview_id: encResponse.data.pixelatedId
    });
      document.getElementById('encryption-status').textContent = 'Encryption complete!';
    document.getElementById('encryption-progress').style.width = '100%';
    
    // Show chain submission section
    document.getElementById('chain-section').style.display = 'block';
    
    // Enable submit button
    document.getElementById('submit-to-chain-btn').disabled = false;
    document.getElementById('chain-status').textContent = 'Ready to submit to blockchain!';
    
  } catch (error) {
    console.error('Encryption failed:', error);
    document.getElementById('encryption-status').textContent = 'Encryption failed: ' + error.message;
    document.getElementById('encryption-status').style.color = 'red';
  }
}

async function submitToChain() {
  try {
    if (!walletConnected) {
      alert('Please connect your wallet first');
      return;
    }
    
    // Ensure contract is properly initialized with signer
    if (!contract || !signer) {
      console.error('Contract or signer not initialized');
      alert('Wallet connection issue. Please refresh and try again.');
      return;
    }
    
    // Show step 4 (submission progress)
    nextStep(); // Move to step 4
    
    // Update submission status using the correct element IDs from step 4
    const submissionStatus = document.getElementById('submission-status');
    const submissionProgress = document.getElementById('submission-progress');
    const submissionMessage = document.getElementById('submission-message');
    
    if (submissionStatus) submissionStatus.textContent = 'Preparing transaction...';
    if (submissionProgress) submissionProgress.style.width = '25%';
    if (submissionMessage) submissionMessage.textContent = 'Please confirm the transaction in your wallet...';
    
    // Verify we can get the signer address before proceeding
    try {
      const signerAddress = await signer.getAddress();
      console.log('Signer address:', signerAddress);
    } catch (addressError) {
      console.error('Failed to get signer address:', addressError);
      alert('Wallet connection issue. Please disconnect and reconnect your wallet.');
      return;
    }
    
    const tx = await contract.commitCapsule(
      capsuleData.title,
      capsuleData.tags,
      ethers.utils.arrayify(capsuleData.encryptionData.encryptedStory),
      capsuleData.encryptionData.revealTimestamp,
      capsuleData.encryptionData.shutterIdentity,
      capsuleData.encryptionData.imageCID
    );
    
    if (submissionStatus) submissionStatus.textContent = 'Transaction submitted! Waiting for confirmation...';
    if (submissionProgress) submissionProgress.style.width = '50%';
    if (submissionMessage) submissionMessage.textContent = 'Transaction submitted! Waiting for blockchain confirmation...';
    
    console.log("Transaction hash:", tx.hash);
    capsuleData.txHash = tx.hash;
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt);
    
    if (submissionStatus) submissionStatus.textContent = 'Getting capsule ID...';
    if (submissionProgress) submissionProgress.style.width = '75%';
    if (submissionMessage) submissionMessage.textContent = 'Transaction confirmed! Finalizing your capsule...';
    
    // Get capsule ID from transaction logs or contract call
    const capsuleCount = await contractRead.capsuleCount();
    capsuleData.capsuleId = capsuleCount.toNumber() - 1;
    
    if (submissionStatus) submissionStatus.textContent = 'Success! Preparing completion screen...';
    if (submissionProgress) submissionProgress.style.width = '100%';
    if (submissionMessage) submissionMessage.textContent = 'Success! Your time capsule has been created!';
    
    // Move to final step with a short delay
    setTimeout(() => {
      populateCompletion();
      nextStep(); // Move to step 5
      console.log("Moved to completion step 5");
    }, 1500);
    
  } catch (error) {
    console.error('Blockchain submission failed:', error);
    const submissionStatus = document.getElementById('submission-status');
    if (submissionStatus) {
      submissionStatus.textContent = 'Submission failed: ' + error.message;
      submissionStatus.style.color = 'red';
    }    // Show a retry button or go back to step 3
    setTimeout(() => {
      if (confirm('Transaction failed. Would you like to go back and try again?')) {
        prevStep(); // Go back to step 3
      }
    }, 2000);
  }
}

// =============  STEP 4: COMPLETION  =============
function populateCompletion() {
  document.getElementById('final-title').textContent = capsuleData.title;
  document.getElementById('final-capsule-id').textContent = capsuleData.capsuleId;
  document.getElementById('final-tx-hash').textContent = capsuleData.txHash;
  document.getElementById('final-reveal-time').textContent = 
    new Date(capsuleData.encryptionData.revealTimestamp * 1000).toLocaleString();
  
  // Show pixelated preview
  document.getElementById('final-preview-image').src = capsuleData.encryptionData.pixelatedImage;
  
  // Setup share URL
  const shareUrl = `${window.location.origin}${window.location.pathname}?capsule=${capsuleData.capsuleId}`;
  document.getElementById('share-url').value = shareUrl;
}

function shareOnTwitter() {
  const text = `I just created a time capsule on Ethereum! 🕰️✨ It will unlock on ${new Date(capsuleData.encryptionData.revealTimestamp * 1000).toLocaleDateString()}`;
  const url = document.getElementById('share-url').value;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(twitterUrl, '_blank');
}

function copyShareUrl() {
  const shareUrl = document.getElementById('share-url');
  shareUrl.select();
  shareUrl.setSelectionRange(0, 99999);
  document.execCommand('copy');
  
  const copyBtn = document.getElementById('copy-url-btn');
  const originalText = copyBtn.textContent;
  copyBtn.textContent = 'Copied!';
  setTimeout(() => {
    copyBtn.textContent = originalText;
  }, 2000);
}

function createAnother() {
  // Reset data
  capsuleData = {
    title: '',
    tags: '',
    story: '',
    image: null,
    encryptionData: null,
    txHash: null,
    capsuleId: null
  };
  
  // Reset form
  document.getElementById('capsule-form').reset();
  
  // Go back to step 1
  showStep(1);
}

function viewAllCapsules() {
  // Navigate to gallery view (we'll implement this later)
  window.location.href = 'gallery.html';
}

// =============  HELPER FUNCTIONS  =============
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

// Helper: convert file to hex string
async function fileToHex(file) {
  const arrayBuffer = await file.arrayBuffer();
  return "0x" + Array.from(new Uint8Array(arrayBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper: upload to IPFS via backend
async function uploadToIPFS(hexData) {
  const res = await axios.post("http://localhost:5000/upload_ipfs", { hex: hexData });
  return res.data;
}

// =============  INITIALIZATION  =============
window.addEventListener("DOMContentLoaded", async () => {
  try {
    // Load configs & ABI
    const cacheBuster = `?v=${Date.now()}`;
    const cfgAll = await (await fetch(`public_config.json${cacheBuster}`)).json();
    
    const fixedNetwork = cfgAll.default_network;
    const fixedCfg = cfgAll[fixedNetwork];
    const shutterCfg = cfgAll["testnet"]; // or "mainnet"
    
    contractAddr = fixedCfg.contract_address;
    contractAbi = await (await fetch(`contract_abi.json${cacheBuster}`)).json();
    shutterApi = shutterCfg.shutter_api_base;
    registryAddr = shutterCfg.registry_address;
    
    // read-only provider
    contractRead = new ethers.Contract(
      contractAddr,
      contractAbi,
      new ethers.providers.JsonRpcProvider(fixedCfg.rpc_url)
    );
      // Try to connect wallet automatically
    try {
      await connectWallet();
    } catch (e) {
      console.log("Auto-connect failed, user will need to connect manually:", e);
    }
    
    // Listen for wallet account changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', function (accounts) {
        if (accounts.length === 0) {
          console.log('Wallet disconnected');
          walletConnected = false;
          updateWalletStatus(false);
          provider = null;
          signer = null;
          contract = null;
        } else {
          console.log('Wallet account changed, reconnecting...');
          connectWallet();
        }
      });
      
      window.ethereum.on('chainChanged', function (chainId) {
        console.log('Chain changed to:', chainId);
        window.location.reload();
      });
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize Shutter WASM
    console.log("Initializing Shutter WASM...");
    try {
      await ensureShutterReady();
      console.log("✅ Shutter WASM ready");
    } catch (e) {
      console.warn("⚠️ Shutter WASM not ready yet, will retry when needed:", e.message);
    }
    
    // Start on step 1
    showStep(1);
    
  } catch (e) {
    console.error("Initialization failed:", e);
  }
});

function setupEventListeners() {
  // Navigation buttons
  document.getElementById('step1-next-btn').onclick = proceedFromStep1;
  document.getElementById('step2-back-btn').onclick = editEntry;
  document.getElementById('step2-confirm-btn').onclick = confirmPreview;
  document.getElementById('step3-back-btn').onclick = prevStep;
  document.getElementById('encrypt-btn').onclick = startEncryption;
  document.getElementById('submit-to-chain-btn').onclick = submitToChain;
  
  // Final step buttons
  document.getElementById('share-twitter-btn').onclick = shareOnTwitter;
  document.getElementById('copy-url-btn').onclick = copyShareUrl;
  document.getElementById('create-another-btn').onclick = createAnother;
  document.getElementById('view-all-btn').onclick = viewAllCapsules;
  
  // Wallet connection
  document.getElementById('connect-wallet-btn').onclick = () => connectWallet(true);
  
  // Progress step navigation
  document.querySelectorAll('.progress-step').forEach((step, index) => {
    step.onclick = () => goToStep(index + 1);
  });
}

// Expose functions globally for HTML onclick handlers
window.connectWallet = connectWallet;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.goToStep = goToStep;
