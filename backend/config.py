# Private configuration file for API keys and sensitive data
# Add this file to .gitignore to keep keys secure

# Pinata IPFS Configuration (V3 API)
# To enable Pinata integration:
# 1. Sign up at https://pinata.cloud
# 2. Go to API Keys section and create a new key
# 3. For V3 API, you need a JWT token instead of API key/secret
# 4. Replace PINATA_JWT with your actual JWT token
# 5. Restart the backend server

# V3 API uses JWT authentication
PINATA_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiI5OGQ5M2EwYi05ZTUxLTQ3MGUtOTU5MC1mY2RkMjc2ZTdlMTQiLCJlbWFpbCI6Imx1aXNAYnJhaW5ib3QuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6Ijk4ZmIyN2Y3NzY2YzFkMmRhZmI4Iiwic2NvcGVkS2V5U2VjcmV0IjoiMDM0YWI0YzZlMWFjOGRmOGIyMjcwNTI4YTY0N2RiZWFjNzdlYjczZTk4MTVjMzQ4ZDBiNGVmZDU4N2Q2ZmQ5YSIsImV4cCI6MTc4MDU2OTExN30.0yoAZs31PVT3ziMmiD2UTzqGTalgfHxDmTvYwHZLPW0"  # Replace with your JWT token

# Legacy V2 API keys (kept for backwards compatibility)
PINATA_API_KEY = "98fb27f7766c1d2dafb8"
PINATA_SECRET_API_KEY = "034ab4c6e1ac8df8b2270528a647dbeac77eb73e9815c348d0b4efd587d6fd9a"

# Optional: Custom Pinata gateway (leave empty to use default)
# If you have a dedicated gateway, enter it here
PINATA_GATEWAY = ""  # e.g., "https://your-gateway.mypinata.cloud"

# Note: If you don't want to use Pinata, just leave the keys as they are.
# The system will automatically detect this and use local storage only.
