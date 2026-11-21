from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Report(db.Model):
    __tablename__ = "reports"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(64), nullable=False, index=True)  # Clerk user ID
    filename = db.Column(db.String(255), nullable=False)
    report_type = db.Column(db.String(32))
    language = db.Column(db.String(8))
    ocr_source = db.Column(db.String(16))
    analysis = db.Column(db.JSON, nullable=False)  # full analysis payload
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), index=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "filename": self.filename,
            "report_type": self.report_type,
            "language": self.language,
            "created_at": self.created_at.isoformat(),
            "analysis": self.analysis,
        }