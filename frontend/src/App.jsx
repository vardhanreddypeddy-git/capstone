import { useState, useEffect, useMemo, useRef } from "react";
import { UserButton, useAuth } from "@clerk/react";
import "./App.css";
import { getTranslations, getStatusText, LANGUAGES } from "./translations";
import { clerkTheme } from "./clerkTheme";

function App() {
  const { getToken } = useAuth();
  const [file, setFile] = useState(null);
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem("preferred_language") || "en";
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [biomarkerFilter, setBiomarkerFilter] = useState("all");
  const [isDragging, setIsDragging] = useState(false);
  const [savedReports, setSavedReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [activeReportId, setActiveReportId] = useState(null);

  const fileInputRef = useRef(null);

  // Active translation dictionary
  const t = getTranslations(language);

  // Persist language choice in localStorage
  useEffect(() => {
    localStorage.setItem("preferred_language", language);
  }, [language]);

  const isImaging = analysis?.report_type === "imaging";

  const handleFileSelection = (selectedFile) => {
    if (!selectedFile) return;

    if (
      selectedFile.type !== "application/pdf" &&
      !selectedFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setMessage(t.selectPdfError);
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setMessage("");
    setAnalysis(null);
    setBiomarkerFilter("all");
  };

  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    handleFileSelection(selectedFile);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const loadSavedReports = async () => {
    setReportsLoading(true);
    try {
      let token = null;
      if (typeof getToken === "function") {
        token = await getToken();
      }
      const response = await fetch("http://127.0.0.1:5000/reports", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(`Failed to load reports (${response.status})`);
      }
      const data = await response.json();
      setSavedReports(data);
    } catch (error) {
      console.error(error);
    } finally {
      setReportsLoading(false);
    }
  };

  const openSavedReport = (report) => {
    setAnalysis(report.analysis);
    setActiveReportId(report.id);
    setBiomarkerFilter("all");
    setMessage("");
    document.querySelector(".dashboard-container")?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    loadSavedReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async () => {
    if (!file) {
      setMessage(t.selectPdfFirst);
      return;
    }

    setLoading(true);
    setMessage("");
    setAnalysis(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("language", language);

    try {
      let token = null;
      try {
        if (typeof getToken === "function") {
          token = await getToken();
        }
      } catch (tokenErr) {
        console.warn("Could not retrieve Clerk session token:", tokenErr);
      }

      const headers = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(
        "http://127.0.0.1:5000/upload",
        {
          method: "POST",
          headers,
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || t.processingError
        );
      }

      setAnalysis(data.analysis);
      setActiveReportId(data.report_id);
      loadSavedReports();
      setMessage(t.reportSuccess);
    } catch (error) {
      console.error(error);
      setMessage(
        error.message || t.genericError
      );
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    if (status === "high") return "↑";
    if (status === "low") return "↓";
    if (status === "normal") return "✓";
    return "?";
  };

  const getImpressionText = (text) => {
    if (!text) return "";

    return text
      .replace(/^\s*fe\s*\.?\s*/i, "")
      .replace(/^\s*SONOGRAPHICALLY\s*[-:]\s*/i, "")
      .replace(/^\s*IMPRESSION\s*[:\-]?\s*/i, "")
      .trim();
  };

  // Biomarker summary calculations
  const biomarkerStats = useMemo(() => {
    const list = analysis?.biomarkers || [];
    let high = 0;
    let low = 0;
    let normal = 0;
    let unknown = 0;

    list.forEach((b) => {
      const s = (b.status || "").toLowerCase();
      if (s === "high") high++;
      else if (s === "low") low++;
      else if (s === "normal") normal++;
      else unknown++;
    });

    return { total: list.length, high, low, normal, unknown, attention: high + low };
  }, [analysis]);

  // Filtered biomarkers based on active filter tab
  const filteredBiomarkers = useMemo(() => {
    const list = analysis?.biomarkers || [];
    if (biomarkerFilter === "all") return list;
    if (biomarkerFilter === "attention") {
      return list.filter((b) => b.status === "high" || b.status === "low");
    }
    if (biomarkerFilter === "normal") {
      return list.filter((b) => b.status === "normal");
    }
    if (biomarkerFilter === "unknown") {
      return list.filter((b) => b.status !== "high" && b.status !== "low" && b.status !== "normal");
    }
    return list;
  }, [analysis, biomarkerFilter]);

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="app-shell">

      {/* ========================================================
          TOP NAVIGATION & HEADER
          ======================================================== */}
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-group">
            <div className="brand-logo" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3V21M3 12H21" stroke="#0EA5E9" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M7 7L17 17M17 7L7 17" stroke="#16324F" strokeWidth="1.5" strokeLinecap="round" opacity="0.3"/>
                <circle cx="12" cy="12" r="3.5" fill="#E0F2FE" stroke="#0284C7" strokeWidth="1.5"/>
              </svg>
            </div>
            <div className="brand-info">
              <h1 className="brand-title">{t.appTitle}</h1>
              <span className="brand-badge">Clinical AI Intelligence</span>
            </div>
          </div>

          <div className="header-actions">
            <div className="language-dropdown-wrapper">
              <span className="lang-icon" aria-hidden="true">🌐</span>
              <select
                id="language"
                aria-label={t.languageLabel || "Language selector"}
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="language-select"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.label}
                  </option>
                ))}
              </select>
              <span className="select-arrow" aria-hidden="true">▾</span>
            </div>

            <div className="user-profile-button-wrap">
              <UserButton appearance={clerkTheme} />
            </div>
          </div>
        </div>
      </header>


      {/* ========================================================
          HERO & WELCOME SECTION (TWO-COLUMN WITH AI ILLUSTRATION)
          ======================================================== */}
      <section className="hero-section">
        <div className="hero-container">
          {/* Left Column: Heading, Subtitle, Features */}
          <div className="hero-content">
            <div className="hero-pill">
              <span className="pill-dot"></span>
              <span>Advanced Healthcare Technology Platform</span>
            </div>
            <h2 className="hero-title">{t.welcomeTitle || "Understand Your Health Reports with AI"}</h2>
            <p className="hero-subtitle">
              {t.welcomeSubtitle || "Upload your medical report to extract biomarkers, understand results and explore helpful health insights."}
            </p>

            <div className="hero-features-grid">
              <div className="feature-card">
                <div className="feature-icon-bubble">🧪</div>
                <div className="feature-card-text">
                  <strong>Biomarker Extraction</strong>
                  <span>Auto-detects lab ranges & units</span>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon-bubble">🩺</div>
                <div className="feature-card-text">
                  <strong>Pattern Recognition</strong>
                  <span>Discovers related clinical signals</span>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon-bubble">🧠</div>
                <div className="feature-card-text">
                  <strong>Medical Knowledge (RAG)</strong>
                  <span>Clinical guides from CDC & MedlinePlus</span>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon-bubble">🌐</div>
                <div className="feature-card-text">
                  <strong>8 Indian Languages</strong>
                  <span>Accessible healthcare in native scripts</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Custom AI Healthcare Illustration */}
          <div className="hero-illustration-col" aria-hidden="true">
            <div className="illustration-wrapper">
              {/* Background glowing rings and circuit nodes */}
              <div className="illustration-bg-glow"></div>
              <svg className="neural-nodes" width="340" height="280" viewBox="0 0 340 280" fill="none">
                <circle cx="50" cy="40" r="3" fill="#38BDF8" opacity="0.7"/>
                <circle cx="290" cy="50" r="3" fill="#38BDF8" opacity="0.7"/>
                <circle cx="310" cy="220" r="3" fill="#0EA5E9" opacity="0.6"/>
                <circle cx="30" cy="240" r="3" fill="#0EA5E9" opacity="0.6"/>
                <line x1="50" y1="40" x2="120" y2="80" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 3" opacity="0.4"/>
                <line x1="290" y1="50" x2="220" y2="90" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 3" opacity="0.4"/>
                <line x1="220" y1="180" x2="310" y2="220" stroke="#0EA5E9" strokeWidth="1" strokeDasharray="3 3" opacity="0.35"/>
              </svg>

              {/* Main Medical Report Mock Card */}
              <div className="mock-report-card">
                <div className="mock-card-header">
                  <div className="mock-header-badge">
                    <span className="mock-dot red"></span>
                    <span className="mock-dot yellow"></span>
                    <span className="mock-dot green"></span>
                  </div>
                  <span className="mock-doc-id">DIAGNOSTIC REPORT #2604</span>
                </div>

                <div className="mock-patient-strip">
                  <div className="mock-avatar">🩺</div>
                  <div className="mock-meta-lines">
                    <span className="mock-meta-name">Comprehensive Health Panel</span>
                    <span className="mock-meta-sub">Blood Chemistry & Imaging Summary</span>
                  </div>
                </div>

                {/* Animated ECG Pulse line */}
                <div className="mock-ecg-box">
                  <svg className="ecg-line" viewBox="0 0 260 40" fill="none">
                    <path
                      d="M0 20 H50 L58 10 L66 32 L74 6 L82 26 L90 20 H150 L158 12 L166 30 L174 8 L182 24 L190 20 H260"
                      stroke="#38BDF8"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="ecg-status-text">Vital Signals Active • 72 BPM</span>
                </div>

                {/* Mock biomarker rows */}
                <div className="mock-biomarker-rows">
                  <div className="mock-row">
                    <span className="mock-row-name">Hemoglobin</span>
                    <div className="mock-bar-wrap">
                      <div className="mock-bar-fill normal" style={{ width: "70%" }}></div>
                    </div>
                    <span className="mock-tag normal">14.2 g/dL</span>
                  </div>
                  <div className="mock-row">
                    <span className="mock-row-name">Blood Glucose</span>
                    <div className="mock-bar-wrap">
                      <div className="mock-bar-fill high" style={{ width: "85%" }}></div>
                    </div>
                    <span className="mock-tag high">105 mg/dL</span>
                  </div>
                  <div className="mock-row">
                    <span className="mock-row-name">HDL Cholesterol</span>
                    <div className="mock-bar-wrap">
                      <div className="mock-bar-fill low" style={{ width: "40%" }}></div>
                    </div>
                    <span className="mock-tag low">36 mg/dL</span>
                  </div>
                </div>
              </div>

              {/* Floating Analytical Badges */}
              <div className="floating-badge badge-ai-confidence">
                <span className="sparkle-icon">✨</span>
                <div className="badge-text">
                  <strong>AI Confidence</strong>
                  <span>99.4% Extraction Rate</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* ========================================================
          PDF UPLOAD CARD (REDESIGNED WITH GRADIENT BORDER)
          ======================================================== */}
      <section className="upload-container">
        <div className="upload-card">
          <div className="upload-card-header">
            <div className="upload-badge-pill">
              <span className="upload-pill-icon">📁</span>
              <span>Fast & Structured Extraction</span>
            </div>
            <h3>{t.uploadTitle}</h3>
            <p>{t.uploadDescription}</p>
          </div>

          <div
            className={`dropzone ${isDragging ? "dropzone-dragging" : ""} ${file ? "dropzone-has-file" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                fileInputRef.current?.click();
              }
            }}
            aria-label="Upload PDF medical report"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />

            {!file ? (
              <div className="dropzone-empty">
                <div className="dropzone-icon-ring">
                  <div className="dropzone-icon">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="12" y1="18" x2="12" y2="12"></line>
                      <line x1="9" y1="15" x2="12" y2="12"></line>
                      <line x1="15" y1="15" x2="12" y2="12"></line>
                    </svg>
                  </div>
                </div>
                <div className="dropzone-text-group">
                  <p className="dropzone-primary-text">{t.choosePdf}</p>
                  <p className="dropzone-secondary-text">
                    {t.clickOrDrag || "Click to browse or drag and drop your PDF here"}
                  </p>
                  <div className="dropzone-spec-pill">
                    <span className="spec-dot"></span>
                    <span>{t.supportedFormat || "Supported format: PDF (up to 25 MB)"}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="dropzone-filled">
                <div className="file-info-badge">
                  <div className="file-type-icon">PDF</div>
                  <div className="file-meta">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatFileSize(file.size)} • {t.pdfSelected}</span>
                  </div>
                  <div className="file-ready-chip">
                    <span className="check-mark">✓</span>
                    <span>Ready</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="change-file-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  🔄 {t.changeFile || "Select a different file"}
                </button>
              </div>
            )}
          </div>

          <div className="upload-controls">
            <button
              className={`btn-primary ${loading ? "btn-loading" : ""}`}
              onClick={handleUpload}
              disabled={loading || !file}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true"></span>
                  <span>{t.analyzingButton}</span>
                </>
              ) : (
                <>
                  <span>{t.analyzeButton}</span>
                </>
              )}
            </button>
          </div>

          {loading && (
            <div className="loading-progress-hint">
              <div className="pulse-bar"></div>
              <span>Processing document with PyMuPDF, OCR & Medical Rules...</span>
            </div>
          )}

          {message && (
            <div
              className={`status-banner ${
                message.includes("success") || message.includes("सफलतापूर्वक") || message.includes("విజయవంతంగా") || message.includes("வெற்றிகரமாக")
                  ? "banner-success"
                  : "banner-info"
              }`}
              role="alert"
            >
              <span className="banner-icon">
                {message.includes("success") || message.includes("सफलतापूर्वक") ? "✓" : "ℹ"}
              </span>
              <span>{message}</span>
            </div>
          )}
        </div>
      </section>


      {/* ========================================================
          SAVED REPORTS HISTORY
          ======================================================== */}
      <section className="saved-reports-container">
        <div className="card">
          <div className="card-header">
            <div className="card-header-titles">
              <div className="section-tag-pill slate">History</div>
              <h3>My Saved Reports</h3>
              <p>Click a report to view its analysis again.</p>
            </div>
          </div>
          <div className="card-body">
            {reportsLoading && <p>Loading reports...</p>}
            {!reportsLoading && savedReports.length === 0 && (
              <p>No saved reports yet. Upload a report to get started.</p>
            )}
            {savedReports.map((report) => (
              <button
                key={report.id}
                type="button"
                className={`saved-report-item ${
                  activeReportId === report.id ? "saved-report-active" : ""
                }`}
                onClick={() => openSavedReport(report)}
              >
                <span className="saved-report-name">{report.filename}</span>
                <span className="saved-report-meta">
                  {report.report_type} • {new Date(report.created_at).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>


      {/* ========================================================
          REPORT ANALYSIS DASHBOARD
          ======================================================== */}
      <main className="dashboard-container">
        <div className="dashboard-header-bar">
          <div className="dashboard-title-group">
            <span className="dashboard-eyebrow">{t.yourReport}</span>
            <h2 className="dashboard-title">
              {analysis
                ? isImaging
                  ? (t.imagingReport || "Imaging Diagnostic Scan")
                  : (t.labReport || "Laboratory Analysis Report")
                : (t.reportOverview || "Report Overview")}
            </h2>
          </div>

          {analysis && (
            <div className="report-type-badge">
              <span className="report-type-icon">{isImaging ? "🩻" : "🧪"}</span>
              <span className="report-type-text">
                {analysis.report_type === "imaging"
                  ? (t.imagingReport || "Imaging Diagnostic Scan")
                  : (t.labReport || "Laboratory Analysis Report")}
              </span>
            </div>
          )}
        </div>

        {/* METRICS SUMMARY CARDS (Calculated from actual backend response) */}
        {analysis && !isImaging && biomarkerStats.total > 0 && (
          <div className="summary-cards-grid">
            <div className="summary-card card-total">
              <div className="summary-icon">📊</div>
              <div className="summary-info">
                <span className="summary-count">{biomarkerStats.total}</span>
                <span className="summary-label">{t.filterAll || "Total Tests"}</span>
              </div>
            </div>
            <div className="summary-card card-normal">
              <div className="summary-icon">🟢</div>
              <div className="summary-info">
                <span className="summary-count">{biomarkerStats.normal}</span>
                <span className="summary-label">{t.filterNormal || "Normal"}</span>
              </div>
            </div>
            <div className="summary-card card-high">
              <div className="summary-icon">🔴</div>
              <div className="summary-info">
                <span className="summary-count">{biomarkerStats.high}</span>
                <span className="summary-label">{t.statusHigh || "High"}</span>
              </div>
            </div>
            <div className="summary-card card-low">
              <div className="summary-icon">🟠</div>
              <div className="summary-info">
                <span className="summary-count">{biomarkerStats.low}</span>
                <span className="summary-label">{t.statusLow || "Low"}</span>
              </div>
            </div>
            {biomarkerStats.unknown > 0 && (
              <div className="summary-card card-unknown">
                <div className="summary-icon">⚪</div>
                <div className="summary-info">
                  <span className="summary-count">{biomarkerStats.unknown}</span>
                  <span className="summary-label">{t.statusUnknown || "Unclassified"}</span>
                </div>
              </div>
            )}
          </div>
        )}


        {/* ========================================================
            OVERALL IMPRESSION & CONCERN LEVEL GRID
            ======================================================== */}
        <div className="insight-grid">

          {/* OVERALL IMPRESSION */}
          <section className="card impression-card">
            <div className="card-header">
              <div className="card-header-icon card-icon-impression">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                  <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                  <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                </svg>
              </div>
              <div className="card-header-titles">
                <div className="section-tag-pill navy">Clinical Summary</div>
                <h3>{t.impressionTitle}</h3>
                <p>{t.impressionSubtitle}</p>
              </div>
            </div>

            <div className="card-body">
              {analysis ? (
                <div className="impression-content">
                  <p>{getImpressionText(analysis.impression) || t.noImpression}</p>
                </div>
              ) : (
                <div className="empty-state-box">
                  <span className="empty-icon">📄</span>
                  <p>{t.uploadPromptImpression}</p>
                </div>
              )}
            </div>
          </section>

          {/* CONCERN LEVEL */}
          <section className="card concern-card">
            <div className="card-header">
              <div className="card-header-icon card-icon-concern">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </div>
              <div className="card-header-titles">
                <div className="section-tag-pill amber">Triage Assessment</div>
                <h3>{t.concernTitle}</h3>
                <p>{t.concernSubtitle}</p>
              </div>
            </div>

            <div className="card-body">
              {analysis && analysis.concern_level ? (
                <div
                  className={`concern-alert-box ${
                    analysis.concern_level.level === "low"
                      ? "concern-low"
                      : "concern-followup"
                  }`}
                >
                  <div className="concern-status-header">
                    <span className="concern-status-indicator">
                      {analysis.concern_level.level === "low" ? "🟢" : "🟠"}
                    </span>
                    <strong className="concern-title-text">
                      {analysis.concern_level.label}
                    </strong>
                  </div>
                  <p className="concern-description-text">
                    {analysis.concern_level.description}
                  </p>
                </div>
              ) : (
                <div className="empty-state-box">
                  <span className="empty-icon">⏳</span>
                  <strong>{t.waitingForAnalysis}</strong>
                  <p>{t.waitingDescription}</p>
                </div>
              )}
            </div>
          </section>
        </div>


        {/* ========================================================
            IMAGING FINDINGS SECTION (If Imaging Report)
            ======================================================== */}
        {isImaging && (
          <section className="card findings-card">
            <div className="card-header">
              <div className="card-header-icon card-icon-imaging">
                🩻
              </div>
              <div className="card-header-titles">
                <div className="section-tag-pill purple">Radiology Observations</div>
                <h3>{t.imagingTitle}</h3>
                <p>{t.imagingSubtitle}</p>
              </div>
            </div>

            <div className="card-body">
              {analysis.findings && analysis.findings.length > 0 ? (
                <div className="findings-grid">
                  {analysis.findings.map((finding, index) => (
                    <div className="finding-item" key={`${finding.organ}-${index}`}>
                      <div className="finding-organ-badge">
                        <span className="finding-pin">📍</span>
                        <strong>{finding.organ}</strong>
                      </div>
                      <p className="finding-desc">{finding.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state-box">
                  <p>{t.noImagingFindings}</p>
                </div>
              )}
            </div>
          </section>
        )}


        {/* ========================================================
            BIOMARKER ANALYSIS SECTION (If Laboratory Report)
            ======================================================== */}
        {!isImaging && (
          <section className="card biomarkers-card">
            <div className="card-header biomarker-header-split">
              <div className="biomarker-title-wrap">
                <div className="card-header-icon card-icon-biomarker">
                  🧪
                </div>
                <div className="card-header-titles">
                  <div className="section-tag-pill teal">Laboratory Data</div>
                  <h3>{t.biomarkerTitle}</h3>
                  <p>{t.biomarkerSubtitle}</p>
                </div>
              </div>

              {analysis && analysis.biomarkers && analysis.biomarkers.length > 0 && (
                <div className="filter-tab-bar" role="tablist" aria-label="Filter biomarkers">
                  <button
                    className={`filter-btn ${biomarkerFilter === "all" ? "filter-active" : ""}`}
                    onClick={() => setBiomarkerFilter("all")}
                    role="tab"
                    aria-selected={biomarkerFilter === "all"}
                  >
                    {t.filterAll || "All"} ({biomarkerStats.total})
                  </button>
                  {biomarkerStats.attention > 0 && (
                    <button
                      className={`filter-btn filter-btn-attention ${biomarkerFilter === "attention" ? "filter-active" : ""}`}
                      onClick={() => setBiomarkerFilter("attention")}
                      role="tab"
                      aria-selected={biomarkerFilter === "attention"}
                    >
                      {t.filterAttention || "Attention"} ({biomarkerStats.attention})
                    </button>
                  )}
                  <button
                    className={`filter-btn ${biomarkerFilter === "normal" ? "filter-active" : ""}`}
                    onClick={() => setBiomarkerFilter("normal")}
                    role="tab"
                    aria-selected={biomarkerFilter === "normal"}
                  >
                    {t.filterNormal || "Normal"} ({biomarkerStats.normal})
                  </button>
                  {biomarkerStats.unknown > 0 && (
                    <button
                      className={`filter-btn ${biomarkerFilter === "unknown" ? "filter-active" : ""}`}
                      onClick={() => setBiomarkerFilter("unknown")}
                      role="tab"
                      aria-selected={biomarkerFilter === "unknown"}
                    >
                      {t.filterUnknown || "Other"} ({biomarkerStats.unknown})
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="card-body">
              {analysis && analysis.biomarkers && analysis.biomarkers.length > 0 ? (
                <div className="biomarkers-grid">
                  {filteredBiomarkers.map((biomarker, index) => {
                    const status = biomarker.status || "unknown";
                    return (
                      <div
                        className={`biomarker-card status-border-${status}`}
                        key={`${biomarker.name}-${index}`}
                      >
                        <div className="biomarker-card-top">
                          <div className="biomarker-name-group">
                            <span className="biomarker-name">{biomarker.name}</span>
                            {biomarker.page && (
                              <span className="page-pill">
                                {t.pageLabel || "P."} {biomarker.page}
                              </span>
                            )}
                          </div>
                          <span className={`status-pill status-${status}`}>
                            <span className="status-symbol">{getStatusIcon(status)}</span>
                            <span>{biomarker.status_label || getStatusText(status, t)}</span>
                          </span>
                        </div>

                        <div className="biomarker-measurement">
                          <span className="measured-value">{biomarker.value}</span>
                          <span className="measured-unit">{biomarker.unit}</span>
                        </div>

                        {biomarker.reference_range && (
                          <div className="reference-row">
                            <span className="ref-label">{t.referenceRange}</span>
                            <span className="ref-val">{biomarker.reference_range}</span>
                          </div>
                        )}

                        {((biomarker.reference_min !== null && biomarker.reference_min !== undefined) ||
                          (biomarker.reference_max !== null && biomarker.reference_max !== undefined)) && (
                          <div className="reference-row">
                            <span className="ref-label">{t.referenceRange}</span>
                            <span className="ref-val">
                              {biomarker.reference_min ?? ""} - {biomarker.reference_max ?? ""}
                            </span>
                          </div>
                        )}

                        {biomarker.status_explanation && (
                          <div className="explanation-box">
                            <p>{biomarker.status_explanation}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state-box">
                  <span className="empty-icon">🧪</span>
                  <p>{analysis ? t.noBiomarkers : t.uploadPromptBiomarkers}</p>
                </div>
              )}
            </div>
          </section>
        )}


        {/* ========================================================
            DETECTED PATTERNS (If Laboratory Report)
            ======================================================== */}
        {!isImaging && (
          <section className="card patterns-card">
            <div className="card-header">
              <div className="card-header-icon card-icon-pattern">
                🔎
              </div>
              <div className="card-header-titles">
                <div className="section-tag-pill green">Clinical Correlations</div>
                <h3>{t.patternsTitle}</h3>
                <p>{t.patternsSubtitle}</p>
              </div>
            </div>

            <div className="card-body">
              {analysis && analysis.patterns && analysis.patterns.length > 0 ? (
                <div className="patterns-grid">
                  {analysis.patterns.map((pattern, index) => (
                    <div className="pattern-item" key={`${pattern.name}-${index}`}>
                      <div className="pattern-item-header">
                        <span className="pattern-tag">Pattern #{index + 1}</span>
                        <h4 className="pattern-name">{pattern.name}</h4>
                      </div>
                      <p className="pattern-desc">{pattern.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state-box">
                  <span className="empty-icon">🔎</span>
                  <p>{analysis ? t.noPatterns : t.uploadPromptPatterns}</p>
                </div>
              )}
            </div>
          </section>
        )}


        {/* ========================================================
            RAG MEDICAL KNOWLEDGE ANALYSIS (INTELLIGENT PANEL)
            ======================================================== */}
        <section className="card knowledge-card">
          <div className="card-header">
            <div className="card-header-icon card-icon-knowledge">
              🧠
            </div>
            <div className="card-header-titles">
              <div className="section-tag-pill indigo">Evidence-Based RAG</div>
              <h3>{t.knowledgeTitle}</h3>
              <p>{t.knowledgeSubtitle}</p>
            </div>
          </div>

          <div className="card-body">
            {analysis && analysis.knowledge && analysis.knowledge.length > 0 ? (
              <div className="knowledge-grid">
                {analysis.knowledge.map((item, index) => (
                  <article className="knowledge-article" key={`${item.title}-${index}`}>
                    <div className="knowledge-article-header">
                      <h4>{item.title}</h4>
                      {item.related_biomarker && (
                        <span className="related-pill">
                          {t.relatedTo} {item.related_biomarker}
                        </span>
                      )}
                    </div>
                    <p className="knowledge-body-text">{item.content}</p>
                    {item.source && (
                      <div className="knowledge-footer">
                        <span className="source-tag">
                          📚 {t.source} {item.source}
                        </span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state-box">
                <span className="empty-icon">📚</span>
                <p>{analysis ? t.noKnowledge : t.uploadPromptKnowledge}</p>
              </div>
            )}
          </div>
        </section>


        {/* ========================================================
            QUESTIONS TO ASK YOUR DOCTOR
            ======================================================== */}
        <section className="card doctor-card">
          <div className="card-header">
            <div className="card-header-icon card-icon-doctor">
              👨‍⚕️
            </div>
            <div className="card-header-titles">
              <div className="section-tag-pill teal">Physician Checklist</div>
              <h3>{t.doctorTitle}</h3>
              <p>{t.doctorSubtitle}</p>
            </div>
          </div>

          <div className="card-body">
            <div className="doctor-note-banner">
              <span className="doctor-note-icon">💡</span>
              <span>{t.doctorNote || "Bring these questions to your next healthcare appointment to discuss with your doctor."}</span>
            </div>

            {analysis && analysis.doctor_questions && analysis.doctor_questions.length > 0 ? (
              <div className="questions-grid">
                {analysis.doctor_questions.map((question, index) => (
                  <div className="question-card" key={index}>
                    <span className="question-number">{index + 1}</span>
                    <p className="question-text">{question}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="questions-grid">
                {[t.defaultQ1, t.defaultQ2, t.defaultQ3, t.defaultQ4].map((q, idx) => (
                  <div className="question-card" key={idx}>
                    <span className="question-number">{idx + 1}</span>
                    <p className="question-text">{q}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>


        {/* ========================================================
            CHATBOT ASSISTANT CARD (INTERACTIVE PREVIEW)
            ======================================================== */}
        <section className="card chatbot-card">
          <div className="card-header">
            <div className="card-header-icon card-icon-chat">
              💬
            </div>
            <div className="card-header-titles">
              <div className="section-tag-pill slate">AI Assistant</div>
              <h3>{t.chatbotTitle}</h3>
              <p>{t.chatbotSubtitle}</p>
            </div>
          </div>

          <div className="card-body">
            <div className="chatbot-wrapper">
              <div className="bot-bubble">
                <span className="bot-avatar">🤖</span>
                <div className="bubble-content">
                  {t.chatbotWelcome}
                </div>
              </div>

              <div className="chat-input-bar">
                <input
                  type="text"
                  placeholder={t.chatPlaceholder}
                  disabled
                  aria-label="Ask medical report question"
                />
                <button disabled className="btn-chat-send">
                  {t.sendButton}
                </button>
              </div>
            </div>
          </div>
        </section>


        {/* ========================================================
            MEDICAL DISCLAIMER
            ======================================================== */}
        <section className="disclaimer-banner">
          <div className="disclaimer-icon-wrap" aria-hidden="true">
            ⚖️
          </div>
          <div className="disclaimer-copy">
            <h4>{t.disclaimerTitle}</h4>
            <p>{t.disclaimerText}</p>
          </div>
        </section>

      </main>

      {/* ========================================================
          FOOTER
          ======================================================== */}
      <footer className="app-footer">
        <div className="footer-inner">
          <p>© {new Date().getFullYear()} AI Health Report Interpreter • Clinical AI Healthcare Platform</p>
          <div className="footer-links">
            <span>Confidential & Educational</span>
            <span>•</span>
            <span>Evidence-based Clinical AI</span>
            <span>•</span>
            <span>8 Regional Languages</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

export default App;
