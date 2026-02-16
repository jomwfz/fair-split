import React, { useState, useMemo, useCallback, useEffect } from 'react';
import './App.css';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Plus,
  Trash2,
  Users,
  Receipt,
  Check,
  Coffee,
  X,
  Edit2,
  RefreshCw,
  Percent,
  QrCode,
  Smartphone,
  ArrowRight,
  Menu,
  LayoutDashboard,
  UtensilsCrossed,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LogOut,
  History,
  Save
} from 'lucide-react'

import { auth, googleProvider, db } from './firebase'; // ดึงตัวตนที่เราสร้างไว้มาใช้
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'; // คำสั่ง Login/Logout
import { collection, addDoc, query, where, getDocs, orderBy, deleteDoc, doc } from 'firebase/firestore'; // คำสั่งฐานข้อมูล
;

// --- Native PromptPay Payload Generator ---
function generatePromptPayPayload(target, amount) {
  const sanitize = (str) => str.replace(/[^0-9]/g, '');
  let targetSanitized = sanitize(target);
  let targetType = targetSanitized.length >= 13 ? '13' : (targetSanitized.length >= 10 ? '10' : null);

  if (!targetType) return null;

  let payload = '000201';
  payload += amount ? '010212' : '010211';

  let merchantInfo = '0016A000000677010111';
  if (targetType === '10') {
    if (targetSanitized.startsWith('0')) targetSanitized = '66' + targetSanitized.substring(1);
    merchantInfo += '011300' + targetSanitized;
  } else {
    merchantInfo += '0213' + targetSanitized;
  }
  payload += '29' + merchantInfo.length.toString().padStart(2, '0') + merchantInfo;
  payload += '5802TH';
  payload += '5303764';

  if (amount) {
    const amtStr = parseFloat(amount).toFixed(2);
    payload += '54' + amtStr.length.toString().padStart(2, '0') + amtStr;
  }

  payload += '6304';

  const crc = (str) => {
    let crc = 0xFFFF;
    let x;
    for (let i = 0; i < str.length; i++) {
      x = ((crc >> 8) ^ str.charCodeAt(i)) & 0xFF;
      x ^= x >> 4;
      crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  };

  return payload + crc(payload);
}

const App = () => {
  // --- STATE ---
  const [members, setMembers] = useState(['เรา']);
  const [items, setItems] = useState([]);
  const [activeTab, setActiveTab] = useState('members');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});

  // Settings
  const [useVat, setUseVat] = useState(false);
  const [useServiceCharge, setUseServiceCharge] = useState(false);
  const [serviceChargePercent, setServiceChargePercent] = useState(10); // ค่าตัวเลขสำหรับคำนวณ
  // ✅ เพิ่ม State String สำหรับควบคุม Input SVC โดยเฉพาะ
  const [svcString, setSvcString] = useState("10");

  // Inputs
  const [memberName, setMemberName] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemQty, setItemQty] = useState('1');
  const [promptPayId, setPromptPayId] = useState('');
  const [showQR, setShowQR] = useState(false);

  // --- 🔥 NEW STATE: Firebase User & History ---
  const [user, setUser] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState([]);

  // --- 🔥 NEW EFFECT: Check Auth Status ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // --- CALCULATIONS (Moved up to be used in Save function) ---
  const groupedItems = useMemo(() => {
    const groups = {};
    items.forEach(item => {
      const groupKey = item.baseName || item.name.replace(/\s\(\d+\)$/, '');
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(item);
    });
    return groups;
  }, [items]);

  useEffect(() => {
    if (items.length > 0) {
      const newGroups = {};
      Object.keys(groupedItems).forEach(g => {
        if (expandedGroups[g] === undefined) newGroups[g] = true;
      });
      if (Object.keys(newGroups).length > 0) setExpandedGroups(prev => ({
        ...prev,
        ...newGroups
      }));
    }
  }, [groupedItems]);

  const {
    subtotal,
    serviceChargeAmount,
    vatAmount,
    grandTotal,
    memberShares
  } = useMemo(() => {
    let rawTotal = 0;
    let shares = {};
    members.forEach(m => shares[m] = 0);
    items.forEach(item => {
      const safePrice = Number(item.price) || 0;
      rawTotal += safePrice;
      const count = item.participants.length;
      if (count > 0) {
        const pricePerPerson = safePrice / count;
        item.participants.forEach(p => {
          if (shares[p] !== undefined) shares[p] += pricePerPerson;
        });
      }
    });
    const svcRate = useServiceCharge ? (serviceChargePercent / 100) : 0;
    const vatRate = useVat ? 0.07 : 0;
    const calculatedSvc = rawTotal * svcRate;
    const vatableAmount = rawTotal + calculatedSvc;
    const calculatedVat = vatableAmount * vatRate;
    const calculatedGrandTotal = rawTotal + calculatedSvc + calculatedVat;
    if (rawTotal > 0) {
      Object.keys(shares).forEach(m => {
        const userRawShare = shares[m];
        const userSvc = userRawShare * svcRate;
        const userVatable = userRawShare + userSvc;
        const userVat = userVatable * vatRate;
        shares[m] = userRawShare + userSvc + userVat;
      });
    }
    return {
      subtotal: rawTotal,
      serviceChargeAmount: calculatedSvc,
      vatAmount: calculatedVat,
      grandTotal: calculatedGrandTotal,
      memberShares: shares
    };
  }, [items, members, useVat, useServiceCharge, serviceChargePercent]);

  // --- 🔥 NEW ACTIONS: Firebase Logic ---
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setHistoryList([]);
    setShowHistory(false);
  };

  const saveBillToHistory = async () => {
    if (!user) return alert("กรุณาเข้าสู่ระบบก่อนบันทึกครับ");
    if (items.length === 0) return alert("ไม่มีรายการอาหารให้บันทึก");

    try {
      await addDoc(collection(db, "bills"), {
        uid: user.uid,
        billName: `บิลวันที่ ${new Date().toLocaleDateString('th-TH')} ${new Date().toLocaleTimeString('th-TH')}`,
        date: new Date(),
        items: items,
        members: members,
        totalAmount: grandTotal, // ใช้ grandTotal ที่คำนวณไว้แล้ว
        subtotal: subtotal,
        serviceChargeAmount: serviceChargeAmount,
        vatAmount: vatAmount
      });
      alert("บันทึกเรียบร้อย! ✅");
    } catch (error) {
      console.error("Error adding document: ", error);
      alert("บันทึกไม่สำเร็จ ❌");
    }
  };

  const fetchHistory = async () => {
    if (!user) return;
    setShowHistory(true);
    try {
      const q = query(
        collection(db, "bills"),
        where("uid", "==", user.uid),
        orderBy("date", "desc")
      );
      const querySnapshot = await getDocs(q);
      const bills = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setHistoryList(bills);
    } catch (error) {
      console.error("Error fetching history:", error);
    }
  };

  const deleteHistoryItem = async (id) => {
    if (!window.confirm("ยืนยันจะลบบิลนี้ไหม?")) return;
    try {
      await deleteDoc(doc(db, "bills", id));
      fetchHistory(); // โหลดใหม่
    } catch (error) {
      console.error("Error deleting:", error);
    }
  };
  
  // ฟังก์ชันโหลดบิลเก่ามาแก้ไข (Optional)
  const loadBillFromHistory = (bill) => {
    if(window.confirm("การโหลดบิลเก่าจะทับข้อมูลปัจจุบัน ยืนยันไหม?")) {
        setMembers(bill.members);
        setItems(bill.items);
        setShowHistory(false);
        setActiveTab('summary');
    }
  }

  // --- ACTIONS (Existing) ---
  const handleClearBill = () => {
    if (window.confirm("ต้องการล้างบิลทั้งหมดและเริ่มใหม่ใช่ไหม?")) {
      setMembers(['เรา']);
      setItems([]);
      setUseVat(false);
      setUseServiceCharge(false);
      setServiceChargePercent(10);
      setSvcString("10"); // ✅ Reset ค่า String ด้วย
      setMemberName('');
      setItemName('');
      setItemPrice('');
      setItemQty('1');
      setPromptPayId('');
      setShowQR(false);
      setActiveTab('members');
    }
  };

  const handleAddMember = useCallback(() => {
    if (memberName.trim() && !members.includes(memberName.trim())) {
      setMembers(prev => [...prev, memberName.trim()]);
      setMemberName('');
    }
  }, [members, memberName]);

  const handleRemoveMember = useCallback((target) => {
    if (members.length <= 1) {
      alert("ต้องมีสมาชิกอย่างน้อย 1 คน");
      return;
    }
    if (window.confirm(`ลบ ${target} ออกใช่ไหม?`)) {
      setMembers(prev => prev.filter(m => m !== target));
      setItems(prevItems => prevItems.map(item => ({
        ...item,
        participants: item.participants.filter(p => p !== target)
      })));
    }
  }, [members]);

  const handleAddItem = useCallback(() => {
    const qty = itemQty ? parseInt(itemQty) : 1;
    const cleanName = itemName.trim();
    if (cleanName && itemPrice) {
      const price = parseFloat(itemPrice);
      if (isNaN(price) || price < 0) {
        alert("ราคาไม่ถูกต้อง");
        return;
      }
      const newItems = [];
      const timestamp = Date.now();
      for (let i = 0; i < qty; i++) {
        let finalName = cleanName;
        if (qty > 1) finalName = `${cleanName} (${i + 1})`;
        newItems.push({
          id: `${timestamp}-${i}-${Math.random().toString(36).substr(2, 9)}`,
          name: finalName,
          baseName: cleanName,
          price: price,
          participants: []
        });
      }
      setItems(prev => [...prev, ...newItems]);
      setExpandedGroups(prev => ({
        ...prev,
        [cleanName]: true
      }));
      setItemName('');
      setItemPrice('');
      setItemQty('1');
    }
  }, [itemName, itemPrice, itemQty]);

  const handleEditItemName = useCallback((id, oldName) => {
    const newName = window.prompt("แก้ไขชื่อรายการ:", oldName);
    if (newName && newName.trim() !== "") {
      setItems(prevItems => prevItems.map(item => {
        if (item.id === id) {
          const trimmedName = newName.trim();
          const newBaseName = trimmedName.replace(/\s\(\d+\)$/, '');
          return {
            ...item,
            name: trimmedName,
            baseName: newBaseName
          };
        }
        return item;
      }));
    }
  }, []);

  const handleRemoveItem = useCallback((id) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const toggleParticipant = useCallback((itemId, member) => {
    setItems(prevItems => prevItems.map(item => {
      if (item.id === itemId) {
        const isSelected = item.participants.includes(member);
        return {
          ...item,
          participants: isSelected ? item.participants.filter(p => p !== member) : [...item.participants, member]
        };
      }
      return item;
    }));
  }, []);

  const toggleGroup = (groupName) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  // ✅ ฟังก์ชันจัดการ Input SVC เพื่อไม่ให้มีเลข 0 นำหน้า
  const handleChangeSvcString = (e) => {
    let valStr = e.target.value;
    // ถ้ามีมากกว่า 1 หลัก และขึ้นต้นด้วย 0 ให้ลบ 0 ออก (เช่น "05" -> "5")
    if (valStr.length > 1 && valStr.startsWith('0')) {
      valStr = valStr.replace(/^0+/, '');
    }
    setSvcString(valStr); // อัปเดตสิ่งที่ตาเห็น
    setServiceChargePercent(Number(valStr)); // อัปเดตค่าจริงที่ใช้คำนวณ
  };

  const qrPayload = useMemo(() => {
    if (!promptPayId || (promptPayId.length !== 10 && promptPayId.length !== 13)) return "";
    if (promptPayId.length === 10 && !promptPayId.startsWith('0')) return "";
    return generatePromptPayPayload(promptPayId, null);
  }, [promptPayId]);

  const isValidLength = (promptPayId.length === 10 && promptPayId.startsWith('0')) || promptPayId.length === 13;

  // --- RENDER ---
  const menuOrder = ['members', 'items', 'summary', 'payment'];
  const currentIndex = menuOrder.indexOf(activeTab);
  const goToNext = () => {
    if (currentIndex < menuOrder.length - 1) setActiveTab(menuOrder[currentIndex + 1]);
  };
  const goToPrev = () => {
    if (currentIndex > 0) setActiveTab(menuOrder[currentIndex - 1]);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'members':
        return (
          <div className="content-card animate-fade-in">
            <div className="section-header">
              <Users size={20} />
              <h3>จัดการสมาชิก ({members.length})</h3>
            </div>
            <div className="member-chips-container">
              {members.map(m => (
                <div key={m} className={`member-chip ${m === 'เรา' ? 'me' : ''}`}>
                  <div className="avatar">{m.charAt(0)}</div>
                  <span>{m}</span>
                  <button onClick={() => handleRemoveMember(m)} className="btn-icon-small">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="input-row">
              <input
                type="text"
                placeholder="เพิ่มชื่อเพื่อน..."
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
              />
              <button onClick={handleAddMember} disabled={!memberName} className="btn-gray-add">
                <Plus size={20} />
              </button>
            </div>
          </div>
        );
      case 'items':
        return (
          <div className="content-card animate-fade-in">
            <div className="section-header">
              <Coffee size={20} />
              <h3>รายการอาหาร</h3>
            </div>
            <div className="add-item-wrapper-blue">
              <div className="add-item-row">
                <input
                  className="input-name"
                  type="text"
                  placeholder="ชื่อเมนู"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                />
                <input
                  className="input-qty"
                  type="number"
                  min="1"
                  placeholder="จำนวน"
                  value={itemQty}
                  onChange={(e) => setItemQty(e.target.value)}
                />
                <input
                  className="input-price"
                  type="number"
                  placeholder="ราคา"
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
                />
                <button onClick={handleAddItem} className="btn-add-blue">เพิ่ม</button>
              </div>
            </div>
            <div className="items-list">
              {items.length === 0 && <div className="empty-state">ยังไม่มีรายการอาหาร</div>}
              {Object.entries(groupedItems).map(([groupName, groupItems]) => {
                const isExpanded = expandedGroups[groupName] !== false;
                return (
                  <div key={groupName} className={`item-group-card ${!isExpanded ? 'collapsed' : ''}`}>
                    <div className="group-header" onClick={() => toggleGroup(groupName)} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span className="group-title">{groupName}</span>
                      </div>
                      <span className="group-count-badge">{groupItems.length} รายการ</span>
                    </div>
                    {isExpanded && (
                      <div className="group-items-container animate-slide-down">
                        {groupItems.map((item, index) => (
                          <div key={item.id} className="sub-item-row">
                            <div className="sub-item-info">
                              <div className="sub-item-name-group">
                                <span className="sub-item-index">#{index + 1}</span>
                                <button onClick={() => handleEditItemName(item.id, item.name)} className="btn-edit-small">
                                  <Edit2 size={10} />
                                </button>
                              </div>
                              <span className="item-price">{item.price.toLocaleString()}</span>
                            </div>
                            <div className="sub-item-controls">
                              <div className="participant-selector">
                                {members.map(m => (
                                  <button key={m} onClick={() => toggleParticipant(item.id, m)} className={`toggle-chip mini ${item.participants.includes(m) ? 'active' : ''}`}>
                                    {item.participants.includes(m) && <Check size={12} strokeWidth={4} />}
                                    {m}
                                  </button>
                                ))}
                              </div>
                              <button onClick={() => handleRemoveItem(item.id)} className="btn-delete">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      case 'summary':
        return (
          <div className="content-card animate-fade-in">
            <div className="section-header">
              <LayoutDashboard size={20} />
              <h3>สรุปยอดที่ต้องจ่าย</h3>
            </div>
            <div className="options-bar" style={{ justifyContent: 'flex-start', marginBottom: '20px' }}>
              <label className={`option-pill ${useServiceCharge ? 'active' : ''}`}>
                <input type="checkbox" checked={useServiceCharge} onChange={(e) => setUseServiceCharge(e.target.checked)} />
                <Percent size={14} /> SVC
                {useServiceCharge && (
                  <div style={{ display: 'flex', alignItems: 'center', marginLeft: '6px' }}>
                    {/* ✅ Input SVC ที่แก้ไขแล้ว: ใช้ svcString, มี placeholder '0', มี spinners */}
                    <input
                      type="number"
                      className="percent-input"
                      placeholder="0"
                      value={svcString}
                      onChange={handleChangeSvcString}
                      onClick={(e) => e.stopPropagation()}
                      min="0"
                    />
                    <span style={{ marginLeft: '4px' }}>%</span>
                  </div>
                )}
              </label>
              <label className={`option-pill ${useVat ? 'active' : ''}`}>
                <input type="checkbox" checked={useVat} onChange={(e) => setUseVat(e.target.checked)} />
                <Percent size={14} /> VAT 7%
              </label>
            </div>
            {items.length > 0 ? (
              <div className="summary-card-dark">
                <div className="bill-breakdown">
                  <div className="breakdown-row">
                    <span>รวมค่าอาหาร</span>
                    <span>{subtotal.toLocaleString()} ฿</span>
                  </div>
                  {useServiceCharge && (
                    <div className="breakdown-row text-muted">
                      <span>Service Charge ({serviceChargePercent}%)</span>
                      <span>{serviceChargeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ฿</span>
                    </div>
                  )}
                  {useVat && (
                    <div className="breakdown-row text-muted">
                      <span>VAT (7%)</span>
                      <span>{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ฿</span>
                    </div>
                  )}
                  <div className="breakdown-row total-row">
                    <span>ยอดสุทธิ</span>
                    <span>{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ฿</span>
                  </div>
                </div>
                <hr className="divider-soft" />
                <div className="summary-rows">
                  {members.map(m => (
                    <div key={m} className="summary-row-dark-item">
                      <div className="summary-name">
                        <div className="avatar-small-dark">{m.charAt(0)}</div>
                        {m}
                      </div>
                      <span className="summary-amount-green">
                        {memberShares[m]?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state">ยังไม่มีข้อมูลการคำนวณ</div>
            )}

            {/* --- 🔥 NEW BUTTONS: Save & History --- */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button 
                onClick={saveBillToHistory} 
                className="btn-nav" 
                style={{ flex: 1, justifyContent: 'center', background: '#e0e7ff', color: '#4f46e5', borderColor: '#c7d2fe' }}
              >
                <Save size={16} /> บันทึกบิล
              </button>
              {user && (
                <button 
                  onClick={fetchHistory} 
                  className="btn-nav" 
                  style={{ flex: 1, justifyContent: 'center', background: '#f0f9ff', color: '#0284c7', borderColor: '#bae6fd' }}
                >
                  <History size={16} /> ดูประวัติ
                </button>
              )}
            </div>

          </div>
        );
      case 'payment':
        return (
          <div className="content-card animate-fade-in">
            <div className="section-header">
              <Wallet size={20} />
              <h3>QR รับเงิน (PromptPay)</h3>
            </div>
            <div className="payment-box">
              <div className="input-row-icon">
                <Smartphone size={18} className="icon-input" />
                <input
                  type="text"
                  className="input-promptpay"
                  placeholder="เบอร์มือถือ / เลขบัตร ปชช."
                  maxLength={13}
                  value={promptPayId}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setPromptPayId(val);
                    setShowQR(false);
                  }}
                />
              </div>
              {!showQR && isValidLength && (
                <button onClick={() => setShowQR(true)} className="btn-create-qr">
                  สร้าง QR Code <ArrowRight size={16} />
                </button>
              )}
              {showQR && isValidLength && (
                <div className="qr-container">
                  <div className="qr-wrapper">
                    <QRCodeCanvas value={qrPayload} size={220} level="M" includeMargin={true} />
                  </div>
                  <div className="qr-info">
                    <span>สแกนจ่ายได้เลย</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const menuItems = [
    { id: 'members', label: 'สมาชิก', icon: <Users size={20} /> },
    { id: 'items', label: 'รายการอาหาร', icon: <UtensilsCrossed size={20} /> },
    { id: 'summary', label: 'สรุปยอด', icon: <LayoutDashboard size={20} /> },
    { id: 'payment', label: 'ชำระเงิน', icon: <Wallet size={20} /> },
  ];

  return (
    <div className="main-layout">
      <div className="mobile-header">
        <div className="brand-mobile">
          <Receipt size={24} color="white" />
          <span className="brand-text">FairSplit</span>
        </div>
        <button className="mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X size={24} color="white" /> : <Menu size={24} color="white" />}
        </button>
      </div>
      <nav className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-box">
            <Receipt size={28} color="white" />
          </div>
          <div className="brand-container">
            <h1 className="sidebar-title">FairSplit</h1>
            <span className="sidebar-subtitle">หารยาวแค่ไหนก็ง่าย</span>
          </div>
        </div>
        <ul className="sidebar-menu">
          {menuItems.map(item => (
            <li
              key={item.id}
              className={activeTab === item.id ? 'active' : ''}
              onClick={() => {
                setActiveTab(item.id);
                setIsMobileMenuOpen(false);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </li>
          ))}
        </ul>

        {/* --- 🔥 NEW UI: Sidebar Footer with Login --- */}
        <div className="sidebar-footer">
          {/* ส่วน Login / Profile */}
          <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(37,99,235,0.05)', borderRadius: '12px', border: '1px solid #eff6ff' }}>
             {user ? (
               <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                 <div style={{display:'flex', alignItems:'center', gap:'8px', overflow:'hidden'}}>
                    <img src={user.photoURL} alt="" style={{width:'32px', height:'32px', borderRadius:'50%'}} />
                    <span style={{fontSize:'0.85rem', fontWeight:'500', color:'#334155', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'80px'}}>{user.displayName.split(' ')[0]}</span>
                 </div>
                 <button onClick={handleLogout} style={{background:'white', border:'1px solid #e2e8f0', borderRadius:'6px', padding:'4px', cursor:'pointer', color:'#ef4444'}}>
                    <LogOut size={14} />
                 </button>
               </div>
             ) : (
               <button onClick={handleLogin} style={{width:'100%', background:'white', border:'1px solid #cbd5e1', borderRadius:'8px', padding:'8px', cursor:'pointer', fontSize:'0.9rem', fontWeight:'600', color:'#475569', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px'}}>
                 <span style={{color: '#EA4335', fontWeight:'bold'}}>G</span> เข้าสู่ระบบ
               </button>
             )}
          </div>

          <div className="total-display-sidebar">
            <small>ยอดรวมทั้งหมด</small>
            <div className="amount">
              {grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿
            </div>
          </div>
          <button onClick={handleClearBill} className="btn-reset-sidebar">
            <RefreshCw size={14} />ล้างบิล
          </button>
        </div>
      </nav>
      <main className="content-area">
        {renderContent()}
        <div className="nav-buttons-container">
          <button
            onClick={goToPrev}
            disabled={currentIndex === 0}
            className="btn-nav prev"
            style={{ visibility: currentIndex === 0 ? 'hidden' : 'visible' }}
          >
            <ChevronLeft size={20} /> ย้อนกลับ
          </button>
          <button
            onClick={goToNext}
            disabled={currentIndex === menuOrder.length - 1}
            className="btn-nav next"
            style={{ visibility: currentIndex === menuOrder.length - 1 ? 'hidden' : 'visible' }}
          >
            ถัดไป <ChevronRight size={20} />
          </button>
        </div>
      </main>
      {isMobileMenuOpen && <div className="overlay" onClick={() => setIsMobileMenuOpen(false)}></div>}

      {/* --- 🔥 NEW UI: History Modal --- */}
      {showHistory && (
        <div className="modal-overlay" style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px'}}>
          <div className="modal-content" style={{background:'white', width:'100%', maxWidth:'400px', borderRadius:'16px', maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
            <div className="modal-header" style={{padding:'16px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <h3 style={{margin:0, fontSize:'1.1rem', display:'flex', alignItems:'center', gap:'8px'}}><History size={20} /> ประวัติบิล</h3>
              <button onClick={() => setShowHistory(false)} style={{background:'none', border:'none', cursor:'pointer', color:'#94a3b8'}}><X size={24} /></button>
            </div>
            
            <div className="history-list" style={{padding:'16px', overflowY:'auto'}}>
              {historyList.length === 0 ? (
                <p style={{textAlign:'center', color:'#94a3b8', marginTop:'20px'}}>ยังไม่มีประวัติบิล</p>
              ) : (
                historyList.map(bill => (
                  <div key={bill.id} className="history-card" onClick={() => loadBillFromHistory(bill)} style={{background:'#f8fafc', border:'1px solid #e2e8f0', padding:'12px', borderRadius:'12px', marginBottom:'10px', cursor:'pointer'}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px'}}>
                      <div style={{display:'flex', flexDirection:'column'}}>
                         <strong style={{color:'#334155', fontSize:'0.95rem'}}>{new Date(bill.date.seconds * 1000).toLocaleDateString('th-TH')}</strong>
                         <small style={{color:'#94a3b8', fontSize:'0.75rem'}}>{new Date(bill.date.seconds * 1000).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</small>
                      </div>
                      <span style={{color:'#2563eb', fontWeight:'700'}}>{bill.totalAmount?.toLocaleString()} ฿</span>
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:'0.8rem', color:'#64748b'}}>
                       <span>{bill.items.length} รายการ | {bill.members.length} คน</span>
                       <button onClick={(e) => { e.stopPropagation(); deleteHistoryItem(bill.id); }} style={{background:'#fee2e2', color:'#ef4444', border:'none', borderRadius:'6px', padding:'4px 8px', cursor:'pointer'}}>ลบ</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App; 