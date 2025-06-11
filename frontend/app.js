/*  app.js — Main Application Router  */
/*  Handles navigation between different steps of capsule creation  */

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
  userName: '',
  encryptionData: null,
  txHash: null,
  capsuleId: null
};

// Current step in the flow
let currentStep = 1;
let encryptionInProgress = false;
let encryptionComplete = false;

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
    
    // Update step title for steps 2-4
    updateStepTitle(step);
    
    // Handle step 3 special logic
    if (step === 3) {
      handleStep3();
    }
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
  // Update the main progress section title for steps 2-4
  const progressSection = document.querySelector('.progress-section .step-title');
  if (progressSection && step > 1) {
    const stepTexts = {
      2: { number: 'Step 2', description: 'Preview Your Entry' },
      3: { number: 'Step 3', description: 'Submit to Blockchain' },
      4: { number: 'Step 4', description: 'Complete!' }
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
  if (currentStep < 4) {
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
  const userName = document.getElementById('entry-title').value.trim(); // Your name
  const entryTitle = document.getElementById('entry-tags').value.trim(); // Title of your entry  
  const story = document.getElementById('entry-story').value.trim();
  const tags = document.getElementById('entry-actual-tags').value.trim(); // Actual tags
  const image = document.getElementById('entry-image').files[0];
  
  if (!userName || !entryTitle || !story || !image) {
    alert('Please fill in all required fields and select an image');
    return false;
  }
  
  // Save data (note: we're using entry-tags for the actual title, and entry-title for the user name)
  capsuleData.title = entryTitle;     // Title of the entry
  capsuleData.tags = tags || entryTitle;  // Use actual tags if provided, otherwise use title
  capsuleData.story = story;
  capsuleData.image = image;
  capsuleData.userName = userName;    // Store the user name separately
  
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
  // Update the title (this is the actual entry title)
  document.getElementById('preview-title').textContent = capsuleData.title;
  
  // Update the issuer (this is the user's name)
  document.getElementById('preview-issuer').textContent = capsuleData.userName;
  
  // Update unlock date (1 year from now)
  const unlockDate = new Date();
  unlockDate.setFullYear(unlockDate.getFullYear() + 1);
  document.getElementById('preview-unlock-date').textContent = 
    unlockDate.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    });
  
  // Update tags
  const tagsContainer = document.querySelector('.preview-tags');
  tagsContainer.innerHTML = '';
  const tags = capsuleData.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
  tags.forEach(tag => {
    const tagElement = document.createElement('span');
    tagElement.className = 'tag';
    tagElement.textContent = `#${tag}`;
    tagsContainer.appendChild(tagElement);
  });

  // Create pixelated image preview
  if (capsuleData.image) {
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = function() {
      // Set canvas size to match the container
      const containerWidth = 350;
      const containerHeight = 200;
      canvas.width = containerWidth;
      canvas.height = containerHeight;
      
      // Clear canvas with light gray background
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, containerWidth, containerHeight);
      
      // Calculate aspect ratio preserving dimensions
      const imgAspectRatio = img.width / img.height;
      const containerAspectRatio = containerWidth / containerHeight;
      
      let drawWidth, drawHeight, offsetX, offsetY;
      
      // Always fit the image within the container, never stretch
      if (imgAspectRatio > containerAspectRatio) {
        // Image is wider - fit to width
        drawWidth = containerWidth;
        drawHeight = containerWidth / imgAspectRatio;
        offsetX = 0;
        offsetY = (containerHeight - drawHeight) / 2;
      } else {
        // Image is taller - fit to height
        drawHeight = containerHeight;
        drawWidth = containerHeight * imgAspectRatio;
        offsetX = (containerWidth - drawWidth) / 2;
        offsetY = 0;
      }
      
      // Create pixelated effect
      const pixelSize = 4;
      const pixelWidth = Math.ceil(drawWidth / pixelSize);
      const pixelHeight = Math.ceil(drawHeight / pixelSize);
      
      // Create temporary canvas for pixelation
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      tempCanvas.width = pixelWidth;
      tempCanvas.height = pixelHeight;
      
      // Disable image smoothing for crisp pixels
      tempCtx.imageSmoothingEnabled = false;
      tempCtx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
      
      // Disable smoothing on main canvas
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tempCanvas, offsetX, offsetY, drawWidth, drawHeight);
    };
    
    // Load the uploaded image
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
    };
    reader.readAsDataURL(capsuleData.image);
  }

  // Start encryption in the background
  startEncryptionInBackground();
}

async function startEncryptionInBackground() {
  if (encryptionInProgress || encryptionComplete) {
    console.log('Encryption already in progress or complete, skipping...');
    return;
  }
  
  console.log('Starting background encryption...');
  encryptionInProgress = true;
  
  // Show encryption status section
  const statusSection = document.getElementById('encryption-status-section');
  if (statusSection) {
    statusSection.style.display = 'block';
  }
  
  // Disable ciphertext copy initially
  const copyBtn = document.getElementById('copy-ciphertext-btn');
  if (copyBtn) {
    copyBtn.style.color = '#999';
    copyBtn.style.cursor = 'default';
    copyBtn.onclick = null;
  }
  
  try {
    document.getElementById('preview-encryption-status').textContent = 'Preparing encryption...';
    document.getElementById('preview-encryption-progress').style.width = '10%';
    
    // 1. Get Shutter identity and encryption metadata from backend
    document.getElementById('preview-encryption-status').textContent = 'Getting encryption parameters...';
    const revealTimestamp = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60); // 1 year from now
    
    const fd = new FormData();
    fd.append("title", capsuleData.title);
    fd.append("tags", capsuleData.tags);
    fd.append("story", capsuleData.story);
    fd.append("image", capsuleData.image);
    fd.append("revealTimestamp", revealTimestamp);
      const encResponse = await window.axios.post("http://localhost:5000/submit_capsule", fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    
    document.getElementById('preview-encryption-progress').style.width = '30%';
    
    // 2. Wait for Shutter WASM to be ready
    document.getElementById('preview-encryption-status').textContent = 'Initializing encryption engine...';
    await ensureShutterReady();
    
    document.getElementById('preview-encryption-progress').style.width = '50%';
      // 3. Encrypt story
    document.getElementById('preview-encryption-status').textContent = 'Encrypting story...';
    const storyHex = "0x" + Array.from(new TextEncoder().encode(capsuleData.story))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const sigmaBytes = new Uint8Array(32);
    crypto.getRandomValues(sigmaBytes);
    const sigmaHex = "0x" + Array.from(sigmaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const encryptedStory = await window.shutter.encryptData(
      storyHex,
      encResponse.data.shutterIdentity,
      encResponse.data.encMeta.eon_key,
      sigmaHex
    );
    
    document.getElementById('preview-encryption-progress').style.width = '70%';
    
    // 4. Encrypt image
    document.getElementById('preview-encryption-status').textContent = 'Encrypting image...';
    const imgHex = await fileToHex(capsuleData.image);
    const encryptedImg = await window.shutter.encryptData(
      imgHex,
      encResponse.data.shutterIdentity,
      encResponse.data.encMeta.eon_key,
      sigmaHex
    );
    
    document.getElementById('preview-encryption-progress').style.width = '85%';
    
    // 5. Upload to IPFS
    document.getElementById('preview-encryption-status').textContent = 'Uploading to IPFS...';
    const uploadResult = await uploadToIPFS(encryptedImg);
    
    document.getElementById('preview-encryption-progress').style.width = '95%';
    
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
    await window.axios.post("http://localhost:5000/save_pixelated", {
      cid: uploadResult.cid,
      preview_id: encResponse.data.pixelatedId
    });
      
    document.getElementById('preview-encryption-status').textContent = 'Encryption complete! Ciphertext ready to copy.';
    document.getElementById('preview-encryption-progress').style.width = '100%';
    
    // Enable ciphertext copy functionality
    const copyBtn = document.getElementById('copy-ciphertext-btn');
    copyBtn.style.color = '#4F46E5';
    copyBtn.style.cursor = 'pointer';
    copyBtn.onclick = copyCiphertext;
    
    encryptionComplete = true;
    encryptionInProgress = false;
    
  } catch (error) {
    console.error('Background encryption failed:', error);
    document.getElementById('preview-encryption-status').textContent = 'Encryption failed: ' + error.message;
    document.getElementById('preview-encryption-status').style.color = 'red';
    encryptionInProgress = false;
  }
}

function copyCiphertext() {
  if (!encryptionComplete || !capsuleData.encryptionData) {
    alert('Encryption is still in progress. Please wait...');
    return;
  }
  
  const ciphertext = capsuleData.encryptionData.encryptedStory;
  navigator.clipboard.writeText(ciphertext).then(() => {
    const copyBtn = document.getElementById('copy-ciphertext-btn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'copied!';
    copyBtn.style.color = '#10B981';
    setTimeout(() => {
      copyBtn.textContent = originalText;
      copyBtn.style.color = '#4F46E5';
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy ciphertext:', err);
    alert('Failed to copy ciphertext to clipboard');
  });
}

function confirmPreview() {
  if (!encryptionComplete) {
    alert('Please wait for encryption to complete before proceeding.');
    return;
  }
  nextStep(); // Go to blockchain submission step
}

// =============  STEP 3: BLOCKCHAIN SUBMISSION  =============
async function handleStep3() {
  // Check if wallet is connected
  if (!walletConnected) {
    // Show wallet connection section
    document.getElementById('wallet-connection-section').style.display = 'block';
    document.getElementById('blockchain-submission-section').style.display = 'none';
    
    // Set up wallet connection button
    document.getElementById('connect-wallet-for-submission').onclick = async () => {
      const connected = await connectWallet(true);
      if (connected) {
        // Hide wallet connection, show blockchain submission
        document.getElementById('wallet-connection-section').style.display = 'none';
        document.getElementById('blockchain-submission-section').style.display = 'block';
        
        // Start blockchain submission
        submitToChain();
      }
    };
  } else {
    // Wallet already connected, proceed with submission
    document.getElementById('wallet-connection-section').style.display = 'none';
    document.getElementById('blockchain-submission-section').style.display = 'block';
    submitToChain();
  }
}

async function submitToChain() {
  try {
    if (!walletConnected) {
      alert('Please connect your wallet first');
      return;
    }
    
    if (!encryptionComplete) {
      alert('Please wait for encryption to complete first');
      return;
    }
    
    // Ensure contract is properly initialized with signer
    if (!contract || !signer) {
      console.error('Contract or signer not initialized');
      alert('Wallet connection issue. Please refresh and try again.');
      return;
    }
    
    // Update submission status
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
      nextStep(); // Move to step 4
      console.log("Moved to completion step 4");
    }, 1500);
    
  } catch (error) {
    console.error('Blockchain submission failed:', error);
    const submissionStatus = document.getElementById('submission-status');
    const submissionMessage = document.getElementById('submission-message');
    
    if (submissionStatus) {
      submissionStatus.textContent = 'Submission failed: ' + error.message;
      submissionStatus.style.color = 'red';
    }
    if (submissionMessage) {
      submissionMessage.textContent = 'Transaction failed. Please try again.';
      submissionMessage.style.color = 'red';
    }
      // Show retry option
    setTimeout(async () => {
      if (confirm('Transaction failed. Would you like to try again?')) {
        // Reset submission UI and retry
        document.getElementById('submission-status').style.color = '';
        document.getElementById('submission-message').style.color = '';
        await submitToChain();
      } else {
        // Go back to step 2
        prevStep();
      }
    }, 2000);
  }
}

// =============  STEP 4: COMPLETION  =============
function populateCompletion() {
  // Update the preview card with final data
  document.getElementById('final-preview-title').textContent = capsuleData.title;
  document.getElementById('final-preview-issuer').textContent = capsuleData.userName;
  
  // Update unlock date
  const unlockDate = new Date(capsuleData.encryptionData.revealTimestamp * 1000);
  document.getElementById('final-unlock-date').textContent = 
    unlockDate.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric'
    });
  
  // Update tags
  const finalTagsContainer = document.getElementById('final-preview-tags');
  finalTagsContainer.innerHTML = '';
  const tags = capsuleData.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
  tags.forEach(tag => {
    const tagElement = document.createElement('span');
    tagElement.className = 'tag';
    tagElement.textContent = `#${tag}`;
    finalTagsContainer.appendChild(tagElement);
  });

  // Recreate pixelated image in final preview
  if (capsuleData.image) {
    const canvas = document.getElementById('final-preview-canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = function() {
      // Set canvas size to match the container
      const containerWidth = 350;
      const containerHeight = 200;
      canvas.width = containerWidth;
      canvas.height = containerHeight;
      
      // Clear canvas with light gray background
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, containerWidth, containerHeight);
      
      // Calculate aspect ratio preserving dimensions
      const imgAspectRatio = img.width / img.height;
      const containerAspectRatio = containerWidth / containerHeight;
      
      let drawWidth, drawHeight, offsetX, offsetY;
      
      if (imgAspectRatio > containerAspectRatio) {
        drawWidth = containerWidth;
        drawHeight = containerWidth / imgAspectRatio;
        offsetX = 0;
        offsetY = (containerHeight - drawHeight) / 2;
      } else {
        drawHeight = containerHeight;
        drawWidth = containerHeight * imgAspectRatio;
        offsetX = (containerWidth - drawWidth) / 2;
        offsetY = 0;
      }
      
      // Create pixelated effect
      const pixelSize = 4;
      const pixelWidth = Math.ceil(drawWidth / pixelSize);
      const pixelHeight = Math.ceil(drawHeight / pixelSize);
      
      // Create temporary canvas for pixelation
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      tempCanvas.width = pixelWidth;
      tempCanvas.height = pixelHeight;
      
      // Disable image smoothing for crisp pixels
      tempCtx.imageSmoothingEnabled = false;
      tempCtx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
      
      // Disable smoothing on main canvas
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tempCanvas, offsetX, offsetY, drawWidth, drawHeight);
    };
    
    // Load the uploaded image
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
    };
    reader.readAsDataURL(capsuleData.image);
  }

  // Enable final ciphertext copy functionality
  const finalCopyBtn = document.getElementById('final-copy-ciphertext-btn');
  if (finalCopyBtn && capsuleData.encryptionData) {
    finalCopyBtn.onclick = () => {
      const ciphertext = capsuleData.encryptionData.encryptedStory;
      navigator.clipboard.writeText(ciphertext).then(() => {
        const originalText = finalCopyBtn.textContent;
        finalCopyBtn.textContent = 'copied!';
        finalCopyBtn.style.color = '#10B981';
        setTimeout(() => {
          finalCopyBtn.textContent = originalText;
          finalCopyBtn.style.color = '#4F46E5';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy ciphertext:', err);
        alert('Failed to copy ciphertext to clipboard');
      });
    };
  }
}

function followOnX() {
  window.open('https://twitter.com/ethereum', '_blank');
}

function shareOnX() {
  const text = `I just created a time capsule on Ethereum! 🕰️✨ It will unlock on ${new Date(capsuleData.encryptionData.revealTimestamp * 1000).toLocaleDateString()}`;
  const shareUrl = `${window.location.origin}${window.location.pathname}?capsule=${capsuleData.capsuleId}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
  window.open(twitterUrl, '_blank');
}

function viewInGallery() {
  // Navigate to gallery view
  window.location.href = 'gallery.html';
}

function encryptAnotherEntry() {
  // Reset data and start over
  capsuleData = {
    title: '',
    tags: '',
    story: '',
    image: null,
    userName: '',
    encryptionData: null,
    txHash: null,
    capsuleId: null
  };
  
  // Reset encryption state
  encryptionInProgress = false;
  encryptionComplete = false;
  
  // Reset form
  document.getElementById('capsule-form').reset();
  
  // Hide encryption status section
  const statusSection = document.getElementById('encryption-status-section');
  if (statusSection) {
    statusSection.style.display = 'none';
  }
  
  // Go back to step 1
  showStep(1);
}

function viewAllCapsules() {
  // Navigate to gallery view
  window.location.href = 'gallery.html';
}

// =============  HELPER FUNCTIONS  =============
// Wait for Shutter WASM to be ready
async function ensureShutterReady() {
  let tries = 0;
  const maxTries = 200; // Increased from 100
  
  while (
    (!window.shutter || typeof window.shutter.encryptData !== "function") &&
    tries < maxTries
  ) {
    await new Promise(res => setTimeout(res, 100)); // Increased delay from 50ms to 100ms
    tries++;
    
    // Log progress every 50 tries
    if (tries % 50 === 0) {
      console.log(`Waiting for Shutter WASM... attempt ${tries}/${maxTries}`);
    }
  }
  
  if (!window.shutter || typeof window.shutter.encryptData !== "function") {
    console.error("Shutter WASM loading failed. Available:", {
      hasShutter: !!window.shutter,
      shutterKeys: window.shutter ? Object.keys(window.shutter) : 'N/A',
      hasBlst: !!window.blst,
      blstKeys: window.blst ? Object.keys(window.blst) : 'N/A'
    });
    throw new Error("Shutter WASM not loaded after extended wait!");
  }
  
  console.log("✅ Shutter WASM ready for encryption");
}

// Helper: convert file to hex string
async function fileToHex(file) {
  const arrayBuffer = await file.arrayBuffer();
  return "0x" + Array.from(new Uint8Array(arrayBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper: upload to IPFS via backend
async function uploadToIPFS(hexData) {
  const res = await window.axios.post("http://localhost:5000/upload_ipfs", { hex: hexData });
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
      // Initialize Shutter WASM with retry mechanism
    console.log("Initializing Shutter WASM...");
    let shutterInitTries = 0;
    const maxShutterTries = 10;
    
    while (shutterInitTries < maxShutterTries) {
      try {
        await ensureShutterReady();
        console.log("✅ Shutter WASM ready");
        break;
      } catch (e) {
        shutterInitTries++;
        console.warn(`⚠️ Shutter WASM init attempt ${shutterInitTries}/${maxShutterTries} failed:`, e.message);
        
        if (shutterInitTries >= maxShutterTries) {
          console.error("❌ Shutter WASM failed to initialize after multiple attempts");
          console.log("The app will continue but encryption may fail until WASM loads");
        } else {
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
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
  document.getElementById('step2-confirm-btn').onclick = confirmPreview;
  
  // Completion step buttons
  const followXBtn = document.getElementById('follow-x-btn');
  const shareXBtn = document.getElementById('share-x-btn');
  const galleryBtn = document.getElementById('gallery-btn');
  const encryptAnotherBtn = document.getElementById('encrypt-another-btn');
  
  if (followXBtn) followXBtn.onclick = followOnX;
  if (shareXBtn) shareXBtn.onclick = shareOnX;
  if (galleryBtn) galleryBtn.onclick = viewInGallery;
  if (encryptAnotherBtn) encryptAnotherBtn.onclick = encryptAnotherEntry;
  
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
