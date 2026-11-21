import os
import logging
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Load backend secrets explicitly from backend/.env
backend_env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(backend_env_path)

from auth import require_auth
from pdf_service import (
    extract_text_from_pdf,
    extract_structured_pdf
)
from report_classifier import classify_report
from biomarker_service import analyze_biomarkers
from analysis_service import analyze_report
from imaging_service import analyze_imaging_report
from gemini_ocr_service import extract_pdf_with_gemini
from translation_service import normalize_language, SUPPORTED_LANGUAGES
from models import db, Report

# Configure server logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("health_interpreter_api")

app = Flask(__name__)

# Database: uses DATABASE_URL if set (e.g. PostgreSQL), otherwise local SQLite
app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv(
    "DATABASE_URL", "sqlite:///health_reports.db"
)
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
db.init_app(app)

with app.app_context():
    db.create_all()

# Parse comma-separated authorized origins from CLERK_AUTHORIZED_PARTIES
raw_azp = os.getenv("CLERK_AUTHORIZED_PARTIES", "http://localhost:5173")
authorized_origins = [
    origin.strip() for origin in raw_azp.split(",") if origin.strip()
] or ["http://localhost:5173"]

# Restrict CORS to authorized frontend origins with explicit headers
CORS(
    app,
    resources={r"/*": {"origins": authorized_origins}},
    allow_headers=["Authorization", "Content-Type"],
    methods=["GET", "POST", "OPTIONS"],
    supports_credentials=True
)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
ALLOWED_EXTENSIONS = {"pdf"}

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

LANGUAGE_DISPLAY_NAMES = {
    "en": "English", "hi": "Hindi", "te": "Telugu",
    "ta": "Tamil", "kn": "Kannada", "ml": "Malayalam",
    "mr": "Marathi", "bn": "Bengali",
}


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


@app.route("/", methods=["GET"])
def home():
    """
    Public backend health check endpoint.
    """
    return jsonify({
        "status": "healthy",
        "message": "AI Health Report Interpreter backend is running"
    })


@app.route("/upload", methods=["POST"])
@require_auth
def upload_report():
    """
    Protected PDF upload and clinical analysis endpoint.
    Requires a valid Clerk session token.
    """
    if "file" not in request.files:
        return jsonify({"error": "No PDF file was uploaded."}), 400

    file = request.files["file"]

    if file.filename == "":
        return jsonify({"error": "No file was selected."}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Only PDF files are supported."}), 400

    filename = secure_filename(file.filename)

    # Use verified Clerk user ID for isolated storage path when available
    user_id = getattr(g, "user_id", None)
    if user_id:
        user_folder = os.path.join(app.config["UPLOAD_FOLDER"], secure_filename(user_id))
        os.makedirs(user_folder, exist_ok=True)
        file_path = os.path.join(user_folder, filename)
    else:
        file_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)

    file.save(file_path)

    try:
        raw_language = request.form.get("language", "en").strip() or "en"
        lang = normalize_language(raw_language)
        response_language = LANGUAGE_DISPLAY_NAMES.get(lang, "English")

        gemini_extraction = None
        try:
            gemini_extraction = extract_pdf_with_gemini(
                file_path,
                response_language=response_language
            )
        except Exception as error:
            logger.warning(
                "Gemini OCR fallback triggered. Reason: %s",
                type(error).__name__
            )

        if gemini_extraction:
            gemini_report_type = gemini_extraction["report_type"]
            has_incomplete_output = (
                (gemini_report_type == "laboratory"
                 and not gemini_extraction["biomarkers"])
                or (gemini_report_type == "imaging"
                    and len(gemini_extraction["text"]) < 40)
                or (gemini_report_type == "general"
                    and len(gemini_extraction["text"]) < 120)
            )
            if has_incomplete_output:
                logger.info(
                    "Gemini OCR output incomplete; falling back to local extraction."
                )
                gemini_extraction = None

        extracted_text = (
            gemini_extraction["text"]
            if gemini_extraction and gemini_extraction["text"]
            else extract_text_from_pdf(file_path)
        )
        ocr_source = "Gemini" if gemini_extraction else "Tesseract"

        if not extracted_text.strip():
            return jsonify({
                "error": "Could not extract readable content from this PDF."
            }), 400

        if gemini_extraction:
            structured_page_count = gemini_extraction["page_count"]
            structured_pdf = None
        else:
            structured_pdf = extract_structured_pdf(file_path)
            structured_page_count = len(structured_pdf.get("pages", []))

        report_type = (
            gemini_extraction["report_type"]
            if gemini_extraction
            else classify_report(extracted_text)
        )

        if report_type == "imaging":
            report_analysis = analyze_imaging_report(extracted_text, lang=lang)
        else:
            biomarkers = []
            if report_type == "laboratory":
                biomarkers = (
                    gemini_extraction["biomarkers"]
                    if gemini_extraction
                    else analyze_biomarkers(structured_pdf)
                )

            report_analysis = analyze_report(biomarkers, lang=lang)
            report_analysis["report_type"] = report_type
            report_analysis["findings"] = []

        if gemini_extraction and gemini_extraction.get("overall_impression"):
            report_analysis["impression"] = gemini_extraction["overall_impression"]

        logger.info(
            "Report processed successfully for user %s | file=%s | ocr=%s | type=%s | lang=%s | biomarkers=%d | findings=%d",
            user_id or "anonymous",
            filename,
            ocr_source,
            report_type,
            lang,
            len(report_analysis.get("biomarkers", [])),
            len(report_analysis.get("findings", []))
        )

        analysis_payload = {
            "report_type": report_type,
            "biomarkers": report_analysis.get("biomarkers", []),
            "findings": report_analysis.get("findings", []),
            "patterns": report_analysis.get("patterns", []),
            "impression": report_analysis.get("impression", ""),
            "concern_level": report_analysis.get("concern_level", {}),
            "knowledge": report_analysis.get("knowledge", []),
            "doctor_questions": report_analysis.get("doctor_questions", []),
        }

        record = Report(
            user_id=user_id or "anonymous",
            filename=filename,
            report_type=report_type,
            language=lang,
            ocr_source=ocr_source,
            analysis=analysis_payload,
        )
        db.session.add(record)
        db.session.commit()

        return jsonify({
            "message": "Report processed successfully",
            "report_id": record.id,
            "filename": filename,
            "status": "document_processed",
            "language": lang,
            "analysis": analysis_payload,
        })

    except Exception as error:
        db.session.rollback()
        logger.error(
            "Server processing error: %s: %s",
            type(error).__name__,
            str(error)
        )
        return jsonify({
            "error": "An error occurred while processing the medical report.",
            "message": "Unable to complete report analysis at this time."
        }), 500


@app.route("/reports", methods=["GET"])
@require_auth
def list_reports():
    """
    Returns the authenticated user's saved reports, newest first.
    """
    rows = (
        Report.query
        .filter_by(user_id=g.user_id)
        .order_by(Report.created_at.desc())
        .limit(50)
        .all()
    )
    return jsonify([row.to_dict() for row in rows])


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )