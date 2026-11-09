# NyayaAI Backend

AI-powered legal assistant backend for everyday citizens in India.

## Project Structure

```
src/
├── config/
│   ├── db.js             # Mongoose connection & connection state helpers
│   ├── env.js            # Centralized environment variable loader
│   └── gemini.js         # Official @google/genai client initialization
├── controllers/
│   └── health.controller.js  # Health check & Gemini test route handlers
├── middleware/
│   ├── errorHandler.js   # Centralized error & 404 response handler
│   ├── logger.js         # Sanitized HTTP request logger (no PII leaked)
│   └── validate.js       # Zod-based validation middleware
├── models/               # Mongoose data models
├── routes/
│   ├── health.routes.js  # /health and /test-gemini routes
│   └── index.js          # API v1 aggregated router
├── services/
│   └── ai/
│       └── gemini.service.js # Google Gemini API integration service
├── utils/
│   └── apiResponse.js    # Standard AppError and JSON response formatters
├── validators/
│   └── gemini.validator.js # Zod schemas for Gemini requests
├── app.js                # Express app setup and middleware configuration
└── server.js             # Application entry point with DB connect and lifecycle handling
```

---

## Prerequisites

- **Node.js**: v18+ (tested on Node v24)
- **MongoDB**: Local MongoDB instance (`mongodb://127.0.0.1:27017`) or MongoDB Atlas URI
- **Google Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)

---

## Setup Instructions

### 1. Configure Environment Variables

Copy the `.env.example` file to `.env`:

```bash
cp .env.example .env
```

Ensure your `.env` contains:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/nyaya_ai
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
```

### 2. Start MongoDB

If using local MongoDB:
```bash
sudo systemctl start mongod
# or
mongod --dbpath /data/db
```

### 3. Install Dependencies & Start the Server

```bash
npm install
npm run dev
```

The server will start at `http://localhost:5000`.

---

## API Testing with Postman / cURL

### 1. Health Check Endpoint

- **Method**: `GET`
- **URL**: `http://localhost:5000/api/v1/health`
- **Description**: Verifies server uptime, environment, and MongoDB connection status.

**cURL:**
```bash
curl -X GET http://localhost:5000/api/v1/health
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "NyayaAI backend service is operational",
  "data": {
    "uptimeSeconds": 42,
    "timestamp": "2026-11-08T08:45:00.000Z",
    "environment": "development",
    "services": {
      "database": "connected",
      "geminiConfigured": true
    }
  }
}
```

---

### 2. Gemini Connectivity Test (POST)

- **Method**: `POST`
- **URL**: `http://localhost:5000/api/v1/test-gemini`
- **Headers**: `Content-Type: application/json`
- **Body (raw JSON)**:
```json
{
  "prompt": "What are the consumer rights under the Consumer Protection Act 2019 in India?"
}
```

**cURL:**
```bash
curl -X POST http://localhost:5000/api/v1/test-gemini \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What are the consumer rights under the Consumer Protection Act 2019 in India?"}'
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "Gemini AI connection successful",
  "data": {
    "prompt": "What are the consumer rights under the Consumer Protection Act 2019 in India?",
    "response": "Under the Consumer Protection Act, 2019, consumers in India have six recognized rights: Right to Safety, Right to Information, Right to Choose, Right to be Heard, Right to Seek Redressal, and Right to Consumer Awareness.",
    "model": "gemini-2.5-flash"
  }
}
```

---

### 3. Validation Error Demonstration (400 Bad Request)

- **Method**: `POST`
- **URL**: `http://localhost:5000/api/v1/test-gemini`
- **Body**:
```json
{
  "prompt": "hi"
}
```

**Expected Response (400 Bad Request):**
```json
{
  "success": false,
  "message": "Validation failed",
  "details": [
    {
      "field": "prompt",
      "message": "Prompt must be at least 3 characters long"
    }
  ]
}
```
