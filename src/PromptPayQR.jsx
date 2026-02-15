import React, { useState, useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Copy, Check, Smartphone, X } from 'lucide-react';

// --- ฟังก์ชันสร้าง Payload เอง (Native) ใส่ไว้ในนี้ ---
function generatePromptPayPayload(target, amount) {
  const sanitize = (str) => str.replace(/[^0-9]/g, '');
  let targetSanitized = sanitize(target);
  let targetType = targetSanitized.length >= 13 ? '13' : (targetSanitized.length >= 10 ? '10' : null);

  if (!targetType) return null;

  let payload = '000201';
  payload += amount ? '010212' : '010211';

  let merchantInfo = '0016A000000677010111';
  if (targetType === '10') {
    if (targetSanitized.startsWith('0')) {
      targetSanitized = '66' + targetSanitized.substring(1);
    }
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
    for (let i = 0; i < str.length; i++) {
      let x = ((crc >> 8) ^ str.charCodeAt(i)) & 0xFF;
      x ^= x >> 4;
      crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  };

  return payload + crc(payload);
}

const PromptPayQR = ({ totalAmount, onClose }) => {
  const [promptPayID, setPromptPayID] = useState(""); 
  const [isCopied, setIsCopied] = useState(false);

  // เรียกใช้ฟังก์ชัน Native
  const qrPayload = useMemo(() => {
    if (!promptPayID) return "";
    // ถ้าเบอร์มือถือต้องขึ้นต้นด้วย 0 และมี 10 หลัก
    if (promptPayID.length === 10 && !promptPayID.startsWith('0')) return "";
    // ถ้าไม่ใช่ 10 และ 13 หลัก ก็ไม่สร้าง
    if (promptPayID.length !== 10 && promptPayID.length !== 13) return "";

    return generatePromptPayPayload(promptPayID, totalAmount);
  }, [promptPayID, totalAmount]);

  const handleCopy = () => {
    if (promptPayID) {
      navigator.clipboard.writeText(promptPayID);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X size={24} />
        </button>

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1 rounded-full mb-3">
             <img src="https://upload.wikimedia.org/wikipedia/commons/c/c5/PromptPay_logo.png" alt="PromptPay" className="h-4" />
             <span className="text-[10px] font-bold">Official Standard</span>
          </div>
          <h3 className="text-xl font-bold text-slate-800">สแกนจ่ายเงิน</h3>
          <p className="text-slate-400 text-xs">กรอกเบอร์มือถือของคุณเพื่อสร้าง QR</p>
        </div>

        <div className="flex justify-center mb-6">
          <div className="bg-white p-4 rounded-xl border-2 border-slate-100 shadow-inner">
            {qrPayload ? (
              <QRCodeCanvas value={qrPayload} size={200} level="M" includeMargin={true} />
            ) : (
              <div className="w-[200px] h-[200px] flex items-center justify-center text-slate-300 text-sm bg-slate-50 rounded-lg">
                กรุณากรอกเบอร์<br/>ให้ถูกต้อง
              </div>
            )}
          </div>
        </div>

        <div className="relative mb-4">
          <div className="absolute top-3 left-3 text-slate-400"><Smartphone size={20}/></div>
          <input
            type="text"
            value={promptPayID}
            onChange={(e) => setPromptPayID(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="เบอร์พร้อมเพย์ (08x...)"
            maxLength={13}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-center font-bold text-lg outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-blue-600 text-white rounded-xl p-4 flex justify-between items-center shadow-lg shadow-blue-200">
          <div>
             <p className="text-[10px] uppercase font-bold opacity-80">ยอดที่ต้องรับ</p>
             <p className="text-2xl font-black">{totalAmount.toLocaleString()} ฿</p>
          </div>
          <button onClick={handleCopy} className="bg-white/20 p-2 rounded-lg hover:bg-white/30 transition-colors">
            {isCopied ? <Check size={20} /> : <Copy size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptPayQR;