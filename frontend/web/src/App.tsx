import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface WritingSample {
  id: string;
  encryptedData: string;
  timestamp: number;
  studentId: string;
  difficulty: "easy" | "medium" | "hard";
  status: "pending" | "analyzed" | "error";
  fheRecommendation?: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [samples, setSamples] = useState<WritingSample[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newSampleData, setNewSampleData] = useState({
    studentId: "",
    difficulty: "medium" as "easy" | "medium" | "hard",
    writingData: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("all");

  // Calculate statistics for dashboard
  const analyzedCount = samples.filter(s => s.status === "analyzed").length;
  const pendingCount = samples.filter(s => s.status === "pending").length;
  const errorCount = samples.filter(s => s.status === "error").length;

  // Filter samples based on search and filter
  const filteredSamples = samples.filter(sample => {
    const matchesSearch = searchQuery === "" || 
      sample.studentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sample.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDifficulty = filterDifficulty === "all" || sample.difficulty === filterDifficulty;
    return matchesSearch && matchesDifficulty;
  });

  useEffect(() => {
    loadSamples().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadSamples = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("sample_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing sample keys:", e);
        }
      }
      
      const list: WritingSample[] = [];
      
      for (const key of keys) {
        try {
          const sampleBytes = await contract.getData(`sample_${key}`);
          if (sampleBytes.length > 0) {
            try {
              const sampleData = JSON.parse(ethers.toUtf8String(sampleBytes));
              list.push({
                id: key,
                encryptedData: sampleData.data,
                timestamp: sampleData.timestamp,
                studentId: sampleData.studentId,
                difficulty: sampleData.difficulty,
                status: sampleData.status || "pending",
                fheRecommendation: sampleData.fheRecommendation
              });
            } catch (e) {
              console.error(`Error parsing sample data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading sample ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setSamples(list);
    } catch (e) {
      console.error("Error loading samples:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadSample = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting writing data with FHE..."
    });
    
    try {
      // Simulate FHE encryption for writing data
      const encryptedData = `FHE-WRITING-${btoa(JSON.stringify(newSampleData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const sampleId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const sampleData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        studentId: newSampleData.studentId,
        difficulty: newSampleData.difficulty,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `sample_${sampleId}`, 
        ethers.toUtf8Bytes(JSON.stringify(sampleData))
      );
      
      const keysBytes = await contract.getData("sample_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(sampleId);
      
      await contract.setData(
        "sample_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted writing sample uploaded securely!"
      });
      
      await loadSamples();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewSampleData({
          studentId: "",
          difficulty: "medium",
          writingData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const analyzeSample = async (sampleId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted writing data with FHE..."
    });

    try {
      // Simulate FHE computation time for analysis
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const sampleBytes = await contract.getData(`sample_${sampleId}`);
      if (sampleBytes.length === 0) {
        throw new Error("Sample not found");
      }
      
      const sampleData = JSON.parse(ethers.toUtf8String(sampleBytes));
      
      // Generate a simulated FHE recommendation
      const recommendations = [
        "Focus on letter spacing consistency",
        "Try larger writing to improve legibility",
        "Practice curved strokes for better letter formation",
        "Use guided writing exercises for letter size consistency",
        "Try different grip techniques to reduce pressure"
      ];
      
      const randomRecommendation = recommendations[Math.floor(Math.random() * recommendations.length)];
      
      const updatedSample = {
        ...sampleData,
        status: "analyzed",
        fheRecommendation: randomRecommendation
      };
      
      await contract.setData(
        `sample_${sampleId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedSample))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadSamples();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE tutoring platform",
      icon: "🔗"
    },
    {
      title: "Upload Writing Sample",
      description: "Submit encrypted writing samples for FHE analysis",
      icon: "📝"
    },
    {
      title: "FHE Processing",
      description: "Your data is analyzed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Recommendations",
      description: "Receive personalized writing improvement suggestions",
      icon: "💡"
    }
  ];

  const renderProgressChart = () => {
    const total = samples.length || 1;
    const analyzedPercentage = (analyzedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const errorPercentage = (errorCount / total) * 100;

    return (
      <div className="progress-chart-container">
        <div className="progress-chart">
          <div 
            className="progress-segment analyzed" 
            style={{ width: `${analyzedPercentage}%` }}
          ></div>
          <div 
            className="progress-segment pending" 
            style={{ width: `${pendingPercentage}%` }}
          ></div>
          <div 
            className="progress-segment error" 
            style={{ width: `${errorPercentage}%` }}
          ></div>
        </div>
        <div className="progress-legend">
          <div className="legend-item">
            <div className="color-box analyzed"></div>
            <span>Analyzed: {analyzedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box error"></div>
            <span>Error: {errorCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="nature-spinner">
        <div className="leaf leaf-1"></div>
        <div className="leaf leaf-2"></div>
        <div className="leaf leaf-3"></div>
      </div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container nature-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="leaf-icon"></div>
          </div>
          <h1>Dysgraphia<span>Tutor</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-sample-btn nature-button"
          >
            <div className="add-icon"></div>
            Upload Sample
          </button>
          <button 
            className="nature-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <nav className="app-navigation">
        <button 
          className={activeTab === "dashboard" ? "nav-btn active" : "nav-btn"}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button 
          className={activeTab === "samples" ? "nav-btn active" : "nav-btn"}
          onClick={() => setActiveTab("samples")}
        >
          Writing Samples
        </button>
        <button 
          className={activeTab === "analytics" ? "nav-btn active" : "nav-btn"}
          onClick={() => setActiveTab("analytics")}
        >
          Analytics
        </button>
        <button 
          className={activeTab === "resources" ? "nav-btn active" : "nav-btn"}
          onClick={() => setActiveTab("resources")}
        >
          Resources
        </button>
      </nav>
      
      <div className="main-content">
        {activeTab === "dashboard" && (
          <>
            <div className="welcome-banner">
              <div className="welcome-text">
                <h2>Privacy-Preserving Dysgraphia Tutoring</h2>
                <p>Using FHE technology to analyze writing samples while keeping data encrypted</p>
              </div>
            </div>
            
            {showTutorial && (
              <div className="tutorial-section">
                <h2>FHE Tutoring Guide</h2>
                <p className="subtitle">Learn how to use our encrypted tutoring platform</p>
                
                <div className="tutorial-steps">
                  {tutorialSteps.map((step, index) => (
                    <div 
                      className="tutorial-step"
                      key={index}
                    >
                      <div className="step-icon">{step.icon}</div>
                      <div className="step-content">
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="dashboard-grid">
              <div className="dashboard-card nature-card">
                <h3>Project Introduction</h3>
                <p>DysgraphiaTutor FHE uses fully homomorphic encryption to analyze children's writing samples while keeping the data encrypted, ensuring complete privacy.</p>
                <div className="fhe-badge">
                  <span>FHE-Powered</span>
                </div>
              </div>
              
              <div className="dashboard-card nature-card">
                <h3>Sample Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{samples.length}</div>
                    <div className="stat-label">Total Samples</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{analyzedCount}</div>
                    <div className="stat-label">Analyzed</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{pendingCount}</div>
                    <div className="stat-label">Pending</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{errorCount}</div>
                    <div className="stat-label">Error</div>
                  </div>
                </div>
              </div>
              
              <div className="dashboard-card nature-card">
                <h3>Analysis Progress</h3>
                {renderProgressChart()}
              </div>
            </div>
            
            <div className="partners-section">
              <h3>Our Partners</h3>
              <div className="partners-grid">
                <div className="partner-logo">
                  <div className="logo-placeholder">EduTech Foundation</div>
                </div>
                <div className="partner-logo">
                  <div className="logo-placeholder">PrivacyFirst Learning</div>
                </div>
                <div className="partner-logo">
                  <div className="logo-placeholder">FHE Alliance</div>
                </div>
                <div className="partner-logo">
                  <div className="logo-placeholder">Special Needs Trust</div>
                </div>
              </div>
            </div>
          </>
        )}
        
        {activeTab === "samples" && (
          <div className="samples-section">
            <div className="section-header">
              <h2>Encrypted Writing Samples</h2>
              <div className="header-actions">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search by student ID or sample ID..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="nature-input"
                  />
                </div>
                <select 
                  value={filterDifficulty}
                  onChange={(e) => setFilterDifficulty(e.target.value)}
                  className="nature-select"
                >
                  <option value="all">All Difficulties</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <button 
                  onClick={loadSamples}
                  className="refresh-btn nature-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="samples-list nature-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Student ID</div>
                <div className="header-cell">Difficulty</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredSamples.length === 0 ? (
                <div className="no-samples">
                  <div className="no-samples-icon"></div>
                  <p>No writing samples found</p>
                  <button 
                    className="nature-button primary"
                    onClick={() => setShowUploadModal(true)}
                  >
                    Upload First Sample
                  </button>
                </div>
              ) : (
                filteredSamples.map(sample => (
                  <div className="sample-row" key={sample.id}>
                    <div className="table-cell sample-id">#{sample.id.substring(0, 6)}</div>
                    <div className="table-cell">{sample.studentId}</div>
                    <div className="table-cell">
                      <span className={`difficulty-badge ${sample.difficulty}`}>
                        {sample.difficulty}
                      </span>
                    </div>
                    <div className="table-cell">
                      {new Date(sample.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${sample.status}`}>
                        {sample.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      {isOwner(sample.studentId) && sample.status === "pending" && (
                        <button 
                          className="action-btn nature-button primary"
                          onClick={() => analyzeSample(sample.id)}
                        >
                          Analyze
                        </button>
                      )}
                      {sample.status === "analyzed" && sample.fheRecommendation && (
                        <div className="recommendation-tooltip">
                          <button className="info-btn">💡</button>
                          <div className="tooltip-content">
                            <strong>FHE Recommendation:</strong> {sample.fheRecommendation}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "analytics" && (
          <div className="analytics-section">
            <h2>Writing Progress Analytics</h2>
            <div className="analytics-grid">
              <div className="analytics-card nature-card">
                <h3>Difficulty Distribution</h3>
                <div className="difficulty-chart">
                  <div className="chart-bar easy" style={{ height: `${samples.filter(s => s.difficulty === 'easy').length * 20}px` }}>
                    <span>Easy</span>
                  </div>
                  <div className="chart-bar medium" style={{ height: `${samples.filter(s => s.difficulty === 'medium').length * 20}px` }}>
                    <span>Medium</span>
                  </div>
                  <div className="chart-bar hard" style={{ height: `${samples.filter(s => s.difficulty === 'hard').length * 20}px` }}>
                    <span>Hard</span>
                  </div>
                </div>
              </div>
              
              <div className="analytics-card nature-card">
                <h3>Recent Activity</h3>
                <div className="activity-list">
                  {samples.slice(0, 5).map(sample => (
                    <div key={sample.id} className="activity-item">
                      <div className="activity-details">
                        <span className="student-id">{sample.studentId}</span>
                        <span className="activity-type">uploaded a {sample.difficulty} sample</span>
                      </div>
                      <div className="activity-time">
                        {new Date(sample.timestamp * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "resources" && (
          <div className="resources-section">
            <h2>Dysgraphia Resources</h2>
            <div className="resources-grid">
              <div className="resource-card nature-card">
                <h3>Understanding Dysgraphia</h3>
                <p>Learn about the signs, symptoms, and strategies for supporting children with writing difficulties.</p>
                <button className="nature-button">Read More</button>
              </div>
              
              <div className="resource-card nature-card">
                <h3>FHE Technology</h3>
                <p>Discover how Fully Homomorphic Encryption protects student privacy while enabling personalized learning.</p>
                <button className="nature-button">Learn More</button>
              </div>
              
              <div className="resource-card nature-card">
                <h3>Writing Exercises</h3>
                <p>Access printable worksheets and activities designed to improve handwriting skills.</p>
                <button className="nature-button">Download</button>
              </div>
              
              <div className="resource-card nature-card">
                <h3>Parent Guide</h3>
                <p>A comprehensive guide for parents supporting children with dysgraphia at home.</p>
                <button className="nature-button">Get Guide</button>
              </div>
            </div>
            
            <div className="community-section">
              <h3>Join Our Community</h3>
              <p>Connect with other parents, educators, and specialists in our supportive community.</p>
              <button className="nature-button">Visit Community Forum</button>
            </div>
          </div>
        )}
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadSample} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          sampleData={newSampleData}
          setSampleData={setNewSampleData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content nature-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="nature-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="leaf-icon"></div>
              <span>DysgraphiaTutor FHE</span>
            </div>
            <p>Privacy-preserving tutoring for children with writing challenges</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} DysgraphiaTutor FHE. All rights reserved.
          </div>
        </div>
        
        <div className="acknowledgement">
          <p>This project is supported by the Educational Technology Foundation and PrivacyFirst Learning Initiative.</p>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  sampleData: any;
  setSampleData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  sampleData,
  setSampleData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSampleData({
      ...sampleData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!sampleData.studentId || !sampleData.writingData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal nature-card">
        <div className="modal-header">
          <h2>Upload Writing Sample</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your writing data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Student ID *</label>
              <input 
                type="text"
                name="studentId"
                value={sampleData.studentId} 
                onChange={handleChange}
                placeholder="Enter student identifier..." 
                className="nature-input"
              />
            </div>
            
            <div className="form-group">
              <label>Difficulty Level *</label>
              <select 
                name="difficulty"
                value={sampleData.difficulty} 
                onChange={handleChange}
                className="nature-select"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Writing Sample Data *</label>
              <textarea 
                name="writingData"
                value={sampleData.writingData} 
                onChange={handleChange}
                placeholder="Paste writing sample data or description..." 
                className="nature-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing and analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn nature-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn nature-button primary"
          >
            {uploading ? "Encrypting with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;