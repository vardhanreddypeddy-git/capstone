# AI Health Report Interpreter

A web app that reads a medical report PDF, extracts the test results (biomarkers) or imaging findings, and explains them in plain language. It supports 8 Indian languages and saves each analysis so users can reopen it later.

## Features

- Upload a PDF lab or imaging report
- Extracts biomarkers with reference ranges and status (normal, high, low)
- Explains findings and patterns, with knowledge-base references
- Lists questions to ask your doctor
- Saves each report to a database and shows a "My Saved Reports" history
- Sign-in with Clerk; each user sees only their own reports

## Tech stack

- **Backend:** Python, Flask, Flask-SQLAlchemy, PyMuPDF, Tesseract OCR, Google Gemini (OCR), Clerk (auth)
- **Frontend:** React, Vite, Clerk React SDK
- **Database:** SQLite for local development, PostgreSQL for deployment

## Project structure

```
capstone/
├── backend/          Flask API, OCR, analysis, database models
│   ├── app.py
│   ├── models.py
│   ├── auth.py
│   ├── requirements.txt
│   └── tests/
└── frontend/         React app
    └── src/App.jsx
```

## Prerequisites

- Python 3.11 or newer
- Node.js LTS (includes npm)
- Tesseract OCR
- WSL Ubuntu (recommended on Windows; see Troubleshooting)
- A Clerk account (free) and a Google Gemini API key

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/vardhanreddypeddy-git/capstone.git
cd capstone
```

### 2. Backend

Run these in Ubuntu (WSL) or macOS/Linux:

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip tesseract-ocr
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `backend/.env` from the example and fill in your keys:

```bash
cp .env.example .env
```

```
CLERK_SECRET_KEY=sk_test_...
CLERK_JWT_KEY=-----BEGIN PUBLIC KEY-----...
CLERK_AUTHORIZED_PARTIES=http://localhost:5173,http://localhost:5174
GEMINI_API_KEY=...
```

`CLERK_AUTHORIZED_PARTIES` must list every frontend address you use, separated by commas with no spaces. Vite may use 5173 or 5174.

The database is created automatically on first run, at `backend/instance/health_reports.db`. To use PostgreSQL instead, set:

```
DATABASE_URL=postgresql+psycopg://user:password@host:5432/dbname
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
```

Set your Clerk publishable key in `frontend/.env`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Then install dependencies:

```bash
npm install
```

## Running the app

Open two terminals.

**Terminal 1 (backend):**

```bash
cd backend
source .venv/bin/activate
python app.py
```

Wait for `Running on http://127.0.0.1:5000`.

**Terminal 2 (frontend):**

```bash
cd
