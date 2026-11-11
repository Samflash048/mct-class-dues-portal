import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import Papa from 'papaparse';
import {
  Search, Lock, CheckCircle2, AlertCircle, Clock,
  Upload, Plus, Save, LogOut, Wallet, Users, FileSpreadsheet,
  ChevronRight, X, ShieldCheck, DollarSign, Copy, Check,
  MessageCircle, Download, Printer, TrendingUp, Building2, Award, FileCheck2, QrCode
} from 'lucide-react';

export default function App() {
  // Core Data State
  const [students, setStudents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [payments, setPayments] = useState([]);
  const [settings, setSettings] = useState({
    bank_name: 'OPay',
    account_number: '0000000000',
    account_name: 'Class Financial Account',
    whatsapp_number: '2348000000000',
    class_title: 'Departmental Class Executive Council',
    finsec_name: 'Solomon K. Samuel'
  });
  const [loading, setLoading] = useState(true);

  // Student View & QR Verification State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [showClearanceSlip, setShowClearanceSlip] = useState(false);
  const [verifiedViaQr, setVerifiedViaQr] = useState(false);

  // Admin & Auth State
  const [session, setSession] = useState(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [adminTab, setAdminTab] = useState('matrix'); // 'matrix' | 'fees' | 'students'

  // Admin Editing State
  const [matrixSearch, setMatrixSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'cleared' | 'owing'
  const [editingCell, setEditingCell] = useState(null);
  const [customAmount, setCustomAmount] = useState('');
  const [savingCell, setSavingCell] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // New Levy / Student State
  const [newCategory, setNewCategory] = useState({
    title: '',
    session: '2025/2026',
    category_type: 'levy',
    target_amount: 0,
    is_active: true
  });
  const [newStudent, setNewStudent] = useState({ reg_number: '', full_name: '' });
  const [csvUploading, setCsvUploading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) setIsAdminView(false);
    });

    fetchAllData();
    return () => subscription.unsubscribe();
  }, []);

  async function fetchAllData() {
    setLoading(true);
    const [stuRes, catRes, payRes, setRes] = await Promise.all([
      supabase.from('students').select('*').order('full_name', { ascending: true }),
      supabase.from('fee_categories').select('*').order('display_order', { ascending: true }),
      supabase.from('payments').select('*'),
      supabase.from('portal_settings').select('*').eq('id', 1).maybeSingle()
    ]);

    const loadedStudents = stuRes.data || [];
    if (stuRes.data) setStudents(loadedStudents);
    if (catRes.data) setCategories(catRes.data);
    if (payRes.data) setPayments(payRes.data);
    if (setRes.data) {
      setSettings((prev) => ({ ...prev, ...setRes.data }));
    }

    // Check if opened via a scanned QR Code (?verify=REG_NUMBER)
    const params = new URLSearchParams(window.location.search);
    const verifyReg = params.get('verify');
    if (verifyReg && loadedStudents.length > 0) {
      const matched = loadedStudents.find(
        (s) => s.reg_number.toLowerCase() === verifyReg.trim().toLowerCase()
      );
      if (matched) {
        setSelectedStudent(matched);
        setSearchQuery(matched.reg_number);
        setVerifiedViaQr(true);
      }
    }

    setLoading(false);
  }

  // Fast Lookup Map: paymentMap[`${student_id}_${category_id}`] = amount_paid
  const paymentMap = useMemo(() => {
    const map = {};
    payments.forEach((p) => {
      map[`${p.student_id}_${p.category_id}`] = Number(p.amount_paid) || 0;
    });
    return map;
  }, [payments]);

  // Helper: Get status for a student + category
  function getFeeStatus(studentId, category) {
    const paid = paymentMap[`${studentId}_${category.id}`] || 0;
    const target = Number(category.target_amount) || 0;
    const balance = Math.max(0, target - paid);

    if (!category.is_active && paid === 0) {
      return { status: 'upcoming', paid, target, balance: 0 };
    }
    if (target > 0 && paid >= target) {
      return { status: 'paid', paid, target, balance: 0 };
    }
    if (paid > 0 && paid < target) {
      return { status: 'partial', paid, target, balance };
    }
    return { status: 'unpaid', paid: 0, target, balance: target };
  }

  // Helper: Total student summary across active categories
  function getStudentSummary(studentId) {
    const activeCats = categories.filter((c) => c.is_active);
    let totalPaid = 0;
    let totalTarget = 0;
    let totalBalance = 0;
    let clearedLevelsCount = 0;

    activeCats.forEach((cat) => {
      const info = getFeeStatus(studentId, cat);
      totalPaid += info.paid;
      totalTarget += info.target;
      totalBalance += info.balance;
      if (info.status === 'paid') clearedLevelsCount++;
    });

    const isFullyCleared = activeCats.length > 0 && totalBalance === 0 && totalTarget > 0;
    return {
      totalPaid,
      totalTarget,
      totalBalance,
      isFullyCleared,
      clearedLevelsCount,
      activeCount: activeCats.length
    };
  }

  // Generate Deterministic Verification Reference Code for Clearance Slip
  function getClearanceRef(student) {
    if (!student) return '';
    const cleanReg = student.reg_number.replace(/[^a-zA-Z0-9]/g, '').slice(-4);
    const idHash = (student.id || '0000').slice(0, 6).toUpperCase();
    return `CLR-${cleanReg}-${idHash}`;
  }

  // Build Verification Deep-Link URL & QR Image Source
  function getVerificationData(student) {
    if (!student) return { verifyUrl: '', qrImageUrl: '' };
    const refCode = getClearanceRef(student);
    const baseUrl = window.location.origin;
    const verifyUrl = `${baseUrl}/?verify=${encodeURIComponent(student.reg_number)}&ref=${encodeURIComponent(refCode)}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=6&data=${encodeURIComponent(verifyUrl)}`;
    return { verifyUrl, qrImageUrl, refCode };
  }

  // Revenue Analytics Computation
  const analytics = useMemo(() => {
    const studentCount = students.length;
    let grandCollected = 0;
    let grandExpected = 0;

    const perCategory = categories.map((cat) => {
      const target = Number(cat.target_amount) || 0;
      const expected = cat.is_active ? target * studentCount : 0;
      let collected = 0;
      let clearedCount = 0;
      let partialCount = 0;

      students.forEach((stu) => {
        const paid = paymentMap[`${stu.id}_${cat.id}`] || 0;
        collected += paid;
        if (target > 0 && paid >= target) clearedCount++;
        else if (paid > 0 && paid < target) partialCount++;
      });

      if (cat.is_active) {
        grandCollected += collected;
        grandExpected += expected;
      }

      const rate = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
      return { ...cat, collected, expected, clearedCount, partialCount, rate };
    });

    const grandOutstanding = Math.max(0, grandExpected - grandCollected);
    const overallRate =
      grandExpected > 0 ? Math.min(100, Math.round((grandCollected / grandExpected) * 100)) : 0;

    return { grandCollected, grandExpected, grandOutstanding, overallRate, perCategory };
  }, [categories, students, paymentMap]);

  // Filter Students for Public Search
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          s.reg_number.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [searchQuery, students]);

  // Filter Students for Admin Matrix
  const matrixStudents = useMemo(() => {
    const q = matrixSearch.trim().toLowerCase();
    return students.filter((s) => {
      const matchesQuery =
        !q ||
        s.full_name.toLowerCase().includes(q) ||
        s.reg_number.toLowerCase().includes(q);

      if (!matchesQuery) return false;
      if (statusFilter === 'all') return true;

      const summary = getStudentSummary(s.id);
      if (statusFilter === 'cleared') return summary.isFullyCleared;
      if (statusFilter === 'owing') return !summary.isFullyCleared;
      return true;
    });
  }, [matrixSearch, statusFilter, students, categories, paymentMap]);

  function handleCopyAccount() {
    navigator.clipboard.writeText(settings.account_number);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  }

  function getWhatsAppReceiptUrl(student) {
    const cleanPhone = (settings.whatsapp_number || '').replace(/\D/g, '');
    const summary = getStudentSummary(student.id);

    const owingItems = categories
      .filter((c) => c.is_active && getFeeStatus(student.id, c).balance > 0)
      .map((c) => `${c.title} (₦${getFeeStatus(student.id, c).balance.toLocaleString()})`)
      .join(', ');

    const itemDetails = owingItems
      ? `Outstanding Dues: *${owingItems}* (Total: ₦${summary.totalBalance.toLocaleString()})`
      : `All active dues cleared! Sending receipt for verification.`;

    const message =
      `Hello FinSec,\n\nI am sending my payment receipt for verification:\n` +
      `• *Name:* ${student.full_name}\n` +
      `• *Reg No:* ${student.reg_number}\n` +
      `• *Details:* ${itemDetails}\n\n` +
      `Please find my transfer receipt attached below.`;

    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  }

  function handleExportCsv() {
    const exportRows = matrixStudents.map((stu, index) => {
      const summary = getStudentSummary(stu.id);
      const row = {
        'S/N': index + 1,
        'Reg Number': stu.reg_number,
        'Full Name': stu.full_name
      };

      categories.forEach((cat) => {
        const info = getFeeStatus(stu.id, cat);
        row[`${cat.title} (${cat.session})`] =
          info.status === 'paid'
            ? `PAID (${info.paid})`
            : info.status === 'partial'
            ? `PARTIAL (${info.paid}/${info.target})`
            : info.status === 'upcoming'
            ? 'INACTIVE'
            : 'UNPAID (0)';
      });

      row['Total Paid (NGN)'] = summary.totalPaid;
      row['Total Outstanding (NGN)'] = summary.totalBalance;
      row['Clearance Status'] = summary.isFullyCleared ? 'CLEARED' : 'OWING';
      return row;
    });

    const csv = Papa.unparse(exportRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Class_Clearance_Ledger_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function handleAdminLogin(e) {
    e.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
    } else {
      setShowLoginModal(false);
      setIsAdminView(true);
      setEmail('');
      setPassword('');
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setIsAdminView(false);
  }

  async function savePaymentAmount(studentId, categoryId, amount) {
    setSavingCell(true);
    const numericAmount = Math.max(0, Number(amount) || 0);

    const { error } = await supabase
      .from('payments')
      .upsert(
        {
          student_id: studentId,
          category_id: categoryId,
          amount_paid: numericAmount,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'student_id,category_id' }
      );

    if (!error) {
      await fetchAllData();
      setEditingCell(null);
    } else {
      alert('Error saving payment: ' + error.message);
    }
    setSavingCell(false);
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    const { error } = await supabase
      .from('portal_settings')
      .upsert({
        id: 1,
        bank_name: settings.bank_name,
        account_number: settings.account_number,
        account_name: settings.account_name,
        whatsapp_number: settings.whatsapp_number,
        class_title: settings.class_title,
        finsec_name: settings.finsec_name,
        updated_at: new Date().toISOString()
      });

    if (error) alert('Error saving settings: ' + error.message);
    else alert('Settings updated!');
    setSavingSettings(false);
  }

  async function handleUpdateCategory(cat) {
    const { error } = await supabase
      .from('fee_categories')
      .update({
        title: cat.title,
        session: cat.session,
        target_amount: Number(cat.target_amount) || 0,
        is_active: cat.is_active
      })
      .eq('id', cat.id);

    if (error) alert('Failed to update fee: ' + error.message);
    else fetchAllData();
  }

  async function handleCreateCategory(e) {
    e.preventDefault();
    if (!newCategory.title) return;
    const nextOrder = categories.length + 1;

    const { error } = await supabase.from('fee_categories').insert([
      {
        ...newCategory,
        target_amount: Number(newCategory.target_amount) || 0,
        display_order: nextOrder
      }
    ]);

    if (error) {
      alert('Error adding fee category: ' + error.message);
    } else {
      setNewCategory({
        title: '',
        session: '2025/2026',
        category_type: 'levy',
        target_amount: 0,
        is_active: true
      });
      fetchAllData();
    }
  }

  function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploading(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data
          .map((row) => {
            const reg =
              row.reg_number ||
              row['Reg No'] ||
              row['Reg Number'] ||
              row.matric ||
              Object.values(row)[0];
            const name =
              row.full_name ||
              row['Full Name'] ||
              row.Name ||
              row.name ||
              Object.values(row)[1];
            return {
              reg_number: String(reg || '').trim(),
              full_name: String(name || '').trim()
            };
          })
          .filter((r) => r.reg_number && r.full_name);

        if (rows.length === 0) {
          alert('No valid rows found. Make sure your CSV has reg_number and full_name columns.');
          setCsvUploading(false);
          return;
        }

        const { error } = await supabase
          .from('students')
          .upsert(rows, { onConflict: 'reg_number' });

        if (error) {
          alert('Upload error: ' + error.message);
        } else {
          alert(`Successfully imported/updated ${rows.length} classmates!`);
          fetchAllData();
        }
        setCsvUploading(false);
        e.target.value = '';
      }
    });
  }

  function handleDownloadSampleCsv() {
    const sample = Papa.unparse([
      { reg_number: '2021/245678', full_name: 'Okonkwo Chinedu Emmanuel' },
      { reg_number: '2021/245679', full_name: 'Adeyemi Oluwaseun Grace' }
    ]);
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'master_class_list_template.csv';
    a.click();
  }

  async function handleAddSingleStudent(e) {
    e.preventDefault();
    if (!newStudent.reg_number || !newStudent.full_name) return;

    const { error } = await supabase
      .from('students')
      .upsert(
        [{ reg_number: newStudent.reg_number.trim(), full_name: newStudent.full_name.trim() }],
        { onConflict: 'reg_number' }
      );

    if (error) alert(error.message);
    else {
      setNewStudent({ reg_number: '', full_name: '' });
      fetchAllData();
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans print:bg-white print:text-black">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div
            onClick={() => {
              setIsAdminView(false);
              setSelectedStudent(null);
              setShowClearanceSlip(false);
              setVerifiedViaQr(false);
              window.history.replaceState({}, '', window.location.pathname);
            }}
            className="flex items-center gap-3 cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">
                Class Dues & Clearance Portal
              </h1>
              <p className="text-xs text-slate-400">100L (2022/2023) — 500L (2026/2027) & Class Levies</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {session ? (
              <>
                <button
                  onClick={() => {
                    setIsAdminView(!isAdminView);
                    setShowClearanceSlip(false);
                  }}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition ${
                    isAdminView
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {isAdminView ? 'Public Student View' : 'FinSec Admin Panel'}
                </button>
                <button
                  onClick={handleLogout}
                  title="Logout Admin"
                  className="p-2 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs flex items-center gap-1.5 transition"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>FinSec Login</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Admin Master Ledger Print Header (Only visible when printing Admin Matrix) */}
      {!showClearanceSlip && (
        <div className="hidden print:block p-6 border-b border-black mb-4">
          <h1 className="text-2xl font-bold uppercase">
            Official Class Financial Clearance Ledger (100L – 500L)
          </h1>
          <p className="text-sm text-gray-700">
            {settings.class_title} • Generated on {new Date().toLocaleDateString()} • Total Classmates: {matrixStudents.length}
          </p>
        </div>
      )}

      {/* Main Content Area */}
      <main
        className={`max-w-7xl mx-auto px-4 sm:px-6 py-8 print:p-2 ${
          showClearanceSlip ? 'print:hidden' : ''
        }`}
      >
        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading class financial records...</div>
        ) : isAdminView && session ? (
          /* ==========================================
             FINSEC ADMIN DASHBOARD ("THE BACKDOOR")
             ========================================== */
          <div className="space-y-6">
            {/* REVENUE ANALYTICS SUMMARY BAR */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Total Cash Collected</span>
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-extrabold text-emerald-400 mt-1">
                  ₦{analytics.grandCollected.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Across all active levels & levies
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Total Expected Revenue</span>
                  <Wallet className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-extrabold text-white mt-1">
                  ₦{analytics.grandExpected.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  For {students.length} registered classmates
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Total Unpaid / Outstanding</span>
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-extrabold text-amber-400 mt-1">
                  ₦{analytics.grandOutstanding.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Pending collection balance
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Overall Collection Rate</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-extrabold text-white mt-1">
                  {analytics.overallRate}%
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full mt-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all"
                    style={{ width: `${analytics.overallRate}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Per-Level Collection Mini Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 print:hidden">
              {analytics.perCategory.map((cat) => (
                <div
                  key={cat.id}
                  className={`p-3 rounded-xl border ${
                    cat.is_active
                      ? 'bg-slate-900/90 border-slate-800'
                      : 'bg-slate-950 border-slate-900 opacity-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white">{cat.title}</span>
                    <span className="text-[10px] text-emerald-400 font-semibold">{cat.rate}%</span>
                  </div>
                  <div className="text-sm font-bold text-emerald-400 mt-1">
                    ₦{cat.collected.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {cat.clearedCount}/{students.length} cleared • {cat.partialCount} partial
                  </div>
                </div>
              ))}
            </div>

            {/* Admin Top Bar & Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800 print:hidden">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setAdminTab('matrix')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
                    adminTab === 'matrix'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  100L–500L Payment Matrix
                </button>
                <button
                  onClick={() => setAdminTab('fees')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
                    adminTab === 'fees'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <DollarSign className="w-4 h-4" />
                  Prices, Levies & Settings
                </button>
                <button
                  onClick={() => setAdminTab('students')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
                    adminTab === 'students'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Class List ({students.length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCsv}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  Export CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-400" />
                  Print Master Ledger
                </button>
              </div>
            </div>

            {/* TAB 1: PAYMENT MATRIX */}
            {adminTab === 'matrix' && (
              <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden print:border-black print:bg-white">
                <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Filter classmates by Name or Reg Number..."
                      value={matrixSearch}
                      onChange={(e) => setMatrixSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {['all', 'cleared', 'owing'].map((flt) => (
                      <button
                        key={flt}
                        onClick={() => setStatusFilter(flt)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                          statusFilter === flt
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-950 text-slate-400 border border-slate-800'
                        }`}
                      >
                        {flt === 'all' ? 'All Students' : flt === 'cleared' ? 'Fully Cleared' : 'Owing'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase text-slate-400 print:bg-gray-100 print:text-black">
                        <th className="py-3.5 px-4 sticky left-0 bg-slate-950 z-10 print:bg-gray-100">
                          Classmate
                        </th>
                        {categories.map((cat) => (
                          <th key={cat.id} className="py-3.5 px-3 text-center min-w-[115px]">
                            <div className="font-bold text-slate-200 print:text-black">{cat.title}</div>
                            <div className="text-[10px] text-slate-400 print:text-gray-600">
                              {cat.session}
                            </div>
                            <div className="text-[11px] text-emerald-400 font-semibold mt-0.5 print:text-black">
                              ₦{Number(cat.target_amount).toLocaleString()}
                            </div>
                          </th>
                        ))}
                        <th className="py-3.5 px-4 text-right min-w-[110px]">Total Owing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-sm print:divide-gray-300">
                      {matrixStudents.map((stu) => {
                        const summary = getStudentSummary(stu.id);
                        return (
                          <tr key={stu.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-3 px-4 sticky left-0 bg-slate-900 z-10 border-r border-slate-800 print:bg-white print:border-gray-300">
                              <div className="font-semibold text-white print:text-black">
                                {stu.full_name}
                              </div>
                              <div className="text-xs text-slate-400 font-mono print:text-gray-600">
                                {stu.reg_number}
                              </div>
                            </td>
                            {categories.map((cat) => {
                              const info = getFeeStatus(stu.id, cat);
                              return (
                                <td key={cat.id} className="p-2 text-center">
                                  <button
                                    onClick={() => {
                                      setEditingCell({ student: stu, category: cat });
                                      setCustomAmount(String(info.paid || ''));
                                    }}
                                    className={`w-full py-2 px-2 rounded-lg text-xs font-medium border transition flex flex-col items-center justify-center gap-0.5 print:border-gray-300 print:text-black ${
                                      info.status === 'paid'
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                        : info.status === 'partial'
                                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                                    }`}
                                  >
                                    {info.status === 'paid' && (
                                      <>
                                        <span className="font-bold">PAID</span>
                                        <span className="text-[10px] opacity-80">
                                          ₦{info.paid.toLocaleString()}
                                        </span>
                                      </>
                                    )}
                                    {info.status === 'partial' && (
                                      <>
                                        <span className="font-bold">PARTIAL</span>
                                        <span className="text-[10px]">
                                          ₦{info.paid.toLocaleString()}/₦{info.target.toLocaleString()}
                                        </span>
                                      </>
                                    )}
                                    {(info.status === 'unpaid' || info.status === 'upcoming') && (
                                      <>
                                        <span>
                                          {info.status === 'upcoming' ? 'Inactive' : 'Unpaid'}
                                        </span>
                                        <span className="text-[10px] opacity-60">₦0</span>
                                      </>
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                            <td className="py-3 px-4 text-right font-bold">
                              {summary.totalBalance === 0 ? (
                                <span className="text-emerald-400 text-xs print:text-black">
                                  CLEARED
                                </span>
                              ) : (
                                <span className="text-amber-400 text-xs print:text-black">
                                  ₦{summary.totalBalance.toLocaleString()}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2: SET SESSION PRICES, LEVIES & BANK SETTINGS */}
            {adminTab === 'fees' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-4">
                  <h3 className="text-base font-bold text-white">
                    Configure Session Dues (100L–500L) & Extra Levies
                  </h3>
                  <p className="text-xs text-slate-400">
                    Set how much the class is paying for each session. Toggle "Active" off if payment for that level hasn't opened yet.
                  </p>

                  <div className="space-y-3">
                    {categories.map((cat, idx) => (
                      <div
                        key={cat.id}
                        className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] uppercase text-slate-400">Title</label>
                            <input
                              type="text"
                              value={cat.title}
                              onChange={(e) => {
                                const updated = [...categories];
                                updated[idx].title = e.target.value;
                                setCategories(updated);
                              }}
                              className="w-full mt-1 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase text-slate-400">Session</label>
                            <input
                              type="text"
                              value={cat.session}
                              onChange={(e) => {
                                const updated = [...categories];
                                updated[idx].session = e.target.value;
                                setCategories(updated);
                              }}
                              className="w-full mt-1 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase text-emerald-400 font-semibold">
                              Amount (₦)
                            </label>
                            <input
                              type="number"
                              value={cat.target_amount}
                              onChange={(e) => {
                                const updated = [...categories];
                                updated[idx].target_amount = e.target.value;
                                setCategories(updated);
                              }}
                              className="w-full mt-1 px-3 py-1.5 bg-slate-900 border border-emerald-500/40 rounded-lg text-sm text-white font-semibold"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-center">
                          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cat.is_active}
                              onChange={(e) => {
                                const updated = [...categories];
                                updated[idx].is_active = e.target.checked;
                                setCategories(updated);
                              }}
                              className="rounded accent-emerald-500"
                            />
                            Active
                          </label>

                          <button
                            onClick={() => handleUpdateCategory(cat)}
                            className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition"
                          >
                            <Save className="w-3.5 h-3.5" />
                            Save
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Column: Bank & Clearance Slip Settings + Add Levy */}
                <div className="space-y-6">
                  <form
                    onSubmit={handleSaveSettings}
                    className="bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-4"
                  >
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-emerald-400" />
                      Bank, WhatsApp & Slip Settings
                    </h3>
                    <div>
                      <label className="text-xs text-slate-300">Class / Department Title</label>
                      <input
                        type="text"
                        value={settings.class_title || ''}
                        onChange={(e) =>
                          setSettings({ ...settings, class_title: e.target.value })
                        }
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300">
                        FinSec Name (Appears on Clearance Slip)
                      </label>
                      <input
                        type="text"
                        value={settings.finsec_name || ''}
                        onChange={(e) =>
                          setSettings({ ...settings, finsec_name: e.target.value })
                        }
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300">Bank Name</label>
                      <input
                        type="text"
                        value={settings.bank_name}
                        onChange={(e) => setSettings({ ...settings, bank_name: e.target.value })}
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300">Account Number</label>
                      <input
                        type="text"
                        value={settings.account_number}
                        onChange={(e) =>
                          setSettings({ ...settings, account_number: e.target.value })
                        }
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300">Account Name</label>
                      <input
                        type="text"
                        value={settings.account_name}
                        onChange={(e) => setSettings({ ...settings, account_name: e.target.value })}
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300">
                        FinSec WhatsApp Number (with 234, no +)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 2348123456789"
                        value={settings.whatsapp_number}
                        onChange={(e) =>
                          setSettings({ ...settings, whatsapp_number: e.target.value })
                        }
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white font-mono"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
                    >
                      {savingSettings ? 'Saving...' : 'Save Portal Settings'}
                    </button>
                  </form>

                  {/* Add Extra Levy Card */}
                  <form
                    onSubmit={handleCreateCategory}
                    className="bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-4"
                  >
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Plus className="w-4 h-4 text-emerald-400" />
                      Add Extra Class Levy
                    </h3>
                    <div>
                      <label className="text-xs text-slate-300">Levy Title</label>
                      <input
                        type="text"
                        placeholder="e.g. FYB Dinner Levy"
                        value={newCategory.title}
                        onChange={(e) =>
                          setNewCategory({ ...newCategory, title: e.target.value })
                        }
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300">Academic Session</label>
                      <input
                        type="text"
                        placeholder="e.g. 2026/2027"
                        value={newCategory.session}
                        onChange={(e) =>
                          setNewCategory({ ...newCategory, session: e.target.value })
                        }
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300">Required Amount (₦)</label>
                      <input
                        type="number"
                        placeholder="e.g. 15000"
                        value={newCategory.target_amount}
                        onChange={(e) =>
                          setNewCategory({ ...newCategory, target_amount: e.target.value })
                        }
                        className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 font-bold text-sm transition"
                    >
                      Create Levy Column
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* TAB 3: UPLOAD MASTER CLASS LIST CSV */}
            {adminTab === 'students' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Upload className="w-4 h-4 text-emerald-400" />
                      Bulk Upload Master Class List (.CSV)
                    </h3>
                    <button
                      onClick={handleDownloadSampleCsv}
                      className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Sample CSV
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Upload your class list CSV with columns{' '}
                    <code className="text-emerald-400">reg_number</code> and{' '}
                    <code className="text-emerald-400">full_name</code>.
                  </p>

                  <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition bg-slate-950/50">
                    <Upload className="w-8 h-8 text-emerald-400 mb-2" />
                    <span className="text-sm font-semibold text-white">
                      {csvUploading
                        ? 'Importing Classmates...'
                        : 'Click to select your Class List CSV'}
                    </span>
                    <span className="text-xs text-slate-400 mt-1">
                      Supports .csv exported from Excel or Google Sheets
                    </span>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCsvUpload}
                      disabled={csvUploading}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Add Single Classmate */}
                <form
                  onSubmit={handleAddSingleStudent}
                  className="bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-4"
                >
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-400" />
                    Add or Update a Single Classmate
                  </h3>
                  <div>
                    <label className="text-xs text-slate-300">Registration Number</label>
                    <input
                      type="text"
                      placeholder="e.g. 2021/245678"
                      value={newStudent.reg_number}
                      onChange={(e) =>
                        setNewStudent({ ...newStudent, reg_number: e.target.value })
                      }
                      className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300">Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Okonkwo Chinedu Emmanuel"
                      value={newStudent.full_name}
                      onChange={(e) =>
                        setNewStudent({ ...newStudent, full_name: e.target.value })
                      }
                      className="w-full mt-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
                  >
                    Save Classmate
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : (
          /* ==========================================
             PUBLIC CLASSMATE SEARCH & CLEARANCE VIEW
             ========================================== */
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center space-y-3 pt-2">
              <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                Official Financial Clearance Portal
              </span>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
                Check Your Class Dues Status
              </h2>
              <p className="text-sm text-slate-400 max-w-xl mx-auto">
                Enter your Registration Number or Name below to view your payment breakdown from 100L (2022/2023) to 500L (2026/2027) and download your official QR-verified clearance slip.
              </p>
            </div>

            {/* Search Input Box */}
            <div className="relative">
              <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Type your Reg Number (e.g. 2021/...) or Surname..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedStudent(null);
                  setVerifiedViaQr(false);
                }}
                className="w-full pl-12 pr-10 py-4 bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-2xl text-base text-white placeholder-slate-500 shadow-xl focus:outline-none transition"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedStudent(null);
                    setVerifiedViaQr(false);
                    window.history.replaceState({}, '', window.location.pathname);
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Search Results Dropdown List */}
            {searchQuery && !selectedStudent && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl divide-y divide-slate-800 overflow-hidden shadow-2xl">
                {filteredStudents.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-400">
                    No classmate found matching "{searchQuery}".
                  </div>
                ) : (
                  filteredStudents.map((stu) => (
                    <button
                      key={stu.id}
                      onClick={() => setSelectedStudent(stu)}
                      className="w-full p-4 flex items-center justify-between hover:bg-slate-800/60 transition text-left"
                    >
                      <div>
                        <div className="font-bold text-white">{stu.full_name}</div>
                        <div className="text-xs text-slate-400 font-mono">{stu.reg_number}</div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                        <span>View Ledger</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Selected Classmate Full Financial Card */}
            {selectedStudent && (
              <div className="space-y-6">
                {/* Official QR Verification Banner (Appears when someone scans a slip QR code) */}
                {verifiedViaQr && (
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500 text-slate-950">
                        <QrCode className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs uppercase font-extrabold tracking-wider text-emerald-400">
                          Authentic QR Verification Match
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5">
                          Live database record verified for <strong>{selectedStudent.full_name}</strong> ({selectedStudent.reg_number}) • Ref: <span className="font-mono text-emerald-300">{getClearanceRef(selectedStudent)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-6 p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                    <div>
                      <span className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
                        Student Financial Ledger
                      </span>
                      <h3 className="text-2xl font-bold text-white mt-0.5">
                        {selectedStudent.full_name}
                      </h3>
                      <p className="text-sm text-slate-400 font-mono">
                        {selectedStudent.reg_number}
                      </p>
                    </div>

                    {(() => {
                      const summary = getStudentSummary(selectedStudent.id);
                      return (
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl text-right">
                            <span className="text-[11px] text-slate-400 block">
                              Total Outstanding Balance
                            </span>
                            <span
                              className={`text-lg font-extrabold ${
                                summary.totalBalance === 0 ? 'text-emerald-400' : 'text-amber-400'
                              }`}
                            >
                              ₦{summary.totalBalance.toLocaleString()}
                            </span>
                          </div>

                          {/* Official Clearance Slip Button */}
                          <button
                            onClick={() => setShowClearanceSlip(true)}
                            className={`px-4 py-3 rounded-xl font-bold text-xs flex items-center gap-2 transition shadow-lg ${
                              summary.isFullyCleared
                                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/10'
                                : 'bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            <FileCheck2 className="w-4 h-4" />
                            {summary.isFullyCleared
                              ? 'Download Official Clearance Slip'
                              : 'View Statement / Slip'}
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Level & Levy Cards Breakdown */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {categories.map((cat) => {
                      const info = getFeeStatus(selectedStudent.id, cat);
                      return (
                        <div
                          key={cat.id}
                          className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                            info.status === 'paid'
                              ? 'bg-emerald-500/5 border-emerald-500/30'
                              : info.status === 'partial'
                              ? 'bg-amber-500/5 border-amber-500/30'
                              : info.status === 'upcoming'
                              ? 'bg-slate-950/40 border-slate-800/60 opacity-60'
                              : 'bg-rose-500/5 border-rose-500/30'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="text-xs text-slate-400">{cat.session}</span>
                              <h4 className="text-base font-bold text-white">{cat.title}</h4>
                            </div>

                            {info.status === 'paid' && (
                              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Cleared
                              </span>
                            )}
                            {info.status === 'partial' && (
                              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> Installment
                              </span>
                            )}
                            {info.status === 'unpaid' && (
                              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 flex items-center gap-1">
                                <AlertCircle className="w-3.5 h-3.5" /> Unpaid
                              </span>
                            )}
                            {info.status === 'upcoming' && (
                              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
                                Not Open Yet
                              </span>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                            <span className="text-slate-400">
                              Fee: <strong>₦{info.target.toLocaleString()}</strong>
                            </span>
                            <span className="text-slate-300">
                              Paid:{' '}
                              <strong className="text-emerald-400">
                                ₦{info.paid.toLocaleString()}
                              </strong>
                            </span>
                            {info.balance > 0 && info.status !== 'upcoming' && (
                              <span className="text-amber-400 font-semibold">
                                Rem: ₦{info.balance.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* BANK ACCOUNT & WHATSAPP RECEIPT SUBMISSION CARD */}
                <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-xl">
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4" />
                      Class Payment Account Details
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-extrabold font-mono text-white tracking-wider">
                        {settings.account_number}
                      </span>
                      <button
                        onClick={handleCopyAccount}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-emerald-400 font-semibold flex items-center gap-1 transition"
                      >
                        {copiedAccount ? (
                          <>
                            <Check className="w-3.5 h-3.5" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-slate-300">
                      <strong>{settings.bank_name}</strong> • {settings.account_name}
                    </p>
                  </div>

                  <a
                    href={getWhatsAppReceiptUrl(selectedStudent)}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full sm:w-auto px-5 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 transition"
                  >
                    <MessageCircle className="w-5 h-5" />
                    Send Payment Receipt on WhatsApp
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* =======================================================
          MODAL 3: STUDENT OFFICIAL E-CLEARANCE SLIP WITH QR CODE
          ======================================================= */}
      {showClearanceSlip && selectedStudent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto print:static print:bg-white print:p-0 print:block">
          <div className="bg-white text-slate-900 rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl space-y-6 my-8 print:my-0 print:shadow-none print:rounded-none print:max-w-none">
            {/* Top Action Bar (Hidden when printing) */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 print:hidden">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                <Award className="w-4 h-4" />
                Official QR-Verified Clearance Slip
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition shadow"
                >
                  <Printer className="w-4 h-4" />
                  Print / Save as PDF
                </button>
                <button
                  onClick={() => setShowClearanceSlip(false)}
                  className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Certificate Body */}
            {(() => {
              const summary = getStudentSummary(selectedStudent.id);
              const { qrImageUrl, refCode } = getVerificationData(selectedStudent);
              const activeCategories = categories.filter((c) => c.is_active);

              return (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-2 border-slate-900 pb-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        {settings.class_title || 'Departmental Class Executive Council'}
                      </p>
                      <h2 className="text-2xl font-extrabold uppercase tracking-tight text-slate-900 mt-0.5">
                        Financial Clearance Certificate
                      </h2>
                      <p className="text-xs text-slate-500 mt-1">
                        Office of the Financial Secretary • Academic Sessions 100L – 500L
                      </p>
                    </div>

                    {/* Official Stamp Badge */}
                    <div
                      className={`px-4 py-2 rounded-xl border-2 text-center ${
                        summary.isFullyCleared
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                          : 'border-amber-600 bg-amber-50 text-amber-800'
                      }`}
                    >
                      <div className="text-[10px] font-bold uppercase tracking-widest">
                        Clearance Status
                      </div>
                      <div className="text-base font-black uppercase">
                        {summary.isFullyCleared ? 'FULLY CLEARED' : 'PROVISIONAL / OWING'}
                      </div>
                    </div>
                  </div>

                  {/* Student Metadata Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-500 block">Student Name</span>
                      <strong className="text-slate-900 text-sm">{selectedStudent.full_name}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Reg Number</span>
                      <strong className="text-slate-900 font-mono text-sm">
                        {selectedStudent.reg_number}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Verification Ref</span>
                      <strong className="text-slate-900 font-mono">{refCode}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Date Issued</span>
                      <strong className="text-slate-900">
                        {new Date().toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </strong>
                    </div>
                  </div>

                  {/* Itemized Payment Table */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 uppercase">
                          <th className="py-2.5 px-4">Fee / Level</th>
                          <th className="py-2.5 px-3">Session</th>
                          <th className="py-2.5 px-3 text-right">Required</th>
                          <th className="py-2.5 px-3 text-right">Amount Paid</th>
                          <th className="py-2.5 px-3 text-right">Balance</th>
                          <th className="py-2.5 px-4 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {activeCategories.map((cat) => {
                          const info = getFeeStatus(selectedStudent.id, cat);
                          return (
                            <tr key={cat.id}>
                              <td className="py-2.5 px-4 font-bold text-slate-900">{cat.title}</td>
                              <td className="py-2.5 px-3 text-slate-600">{cat.session}</td>
                              <td className="py-2.5 px-3 text-right">
                                ₦{info.target.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold text-emerald-700">
                                ₦{info.paid.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold text-rose-600">
                                ₦{info.balance.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-4 text-center font-bold uppercase">
                                {info.status === 'paid' ? (
                                  <span className="text-emerald-700">PAID</span>
                                ) : info.status === 'partial' ? (
                                  <span className="text-amber-700">PARTIAL</span>
                                ) : (
                                  <span className="text-rose-600">UNPAID</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
                          <td colSpan={2} className="py-3 px-4 uppercase">
                            Total Summary
                          </td>
                          <td className="py-3 px-3 text-right">
                            ₦{summary.totalTarget.toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-right text-emerald-700">
                            ₦{summary.totalPaid.toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-right text-rose-600">
                            ₦{summary.totalBalance.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {summary.clearedLevelsCount}/{summary.activeCount} Cleared
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* QR Code Verification + FinSec Sign-off Footer */}
                  <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center sm:items-end justify-between gap-6 text-xs">
                    {/* Scannable QR Code Block */}
                    <div className="flex items-center gap-4">
                      <div className="p-1.5 border-2 border-slate-900 rounded-xl bg-white shrink-0">
                        <img
                          src={qrImageUrl}
                          alt="Verification QR Code"
                          className="w-24 h-24 object-contain"
                        />
                      </div>
                      <div className="space-y-1 text-slate-500 max-w-xs">
                        <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                          Scan to Verify Authenticity
                        </div>
                        <p className="text-[11px] leading-relaxed">
                          Scan this QR code with any phone camera to verify live clearance status directly on the official portal.
                        </p>
                        <p className="font-mono text-[10px] text-slate-700">
                          Ref: <strong>{refCode}</strong>
                        </p>
                      </div>
                    </div>

                    {/* FinSec Signature Block */}
                    <div className="text-center sm:text-right min-w-[200px]">
                      <div className="border-b border-slate-900 pb-1 mb-1 font-serif italic text-base text-slate-800">
                        {settings.finsec_name || 'Financial Secretary'}
                      </div>
                      <div className="font-bold text-slate-900 uppercase">
                        {settings.finsec_name || 'Financial Secretary'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Financial Secretary • Authorized Signatory
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* MODAL 1: ADMIN CELL QUICK-EDITOR */}
      {editingCell && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs uppercase text-emerald-400 font-bold">
                  Update Payment Record
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  {editingCell.student.full_name}
                </h3>
                <p className="text-xs text-slate-400">
                  {editingCell.category.title} ({editingCell.category.session}) • Required:{' '}
                  <strong>₦{Number(editingCell.category.target_amount).toLocaleString()}</strong>
                </p>
              </div>
              <button
                onClick={() => setEditingCell(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={savingCell}
                onClick={() =>
                  savePaymentAmount(
                    editingCell.student.id,
                    editingCell.category.id,
                    editingCell.category.target_amount
                  )
                }
                className="py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                Mark Full Paid (₦{Number(editingCell.category.target_amount).toLocaleString()})
              </button>

              <button
                disabled={savingCell}
                onClick={() =>
                  savePaymentAmount(editingCell.student.id, editingCell.category.id, 0)
                }
                className="py-2.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 font-semibold text-xs transition"
              >
                Reset to Unpaid (₦0)
              </button>
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-2">
              <label className="text-xs text-slate-300 block">
                Or enter custom installment amount paid so far (₦):
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="e.g. 1500"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="flex-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                />
                <button
                  disabled={savingCell}
                  onClick={() =>
                    savePaymentAmount(
                      editingCell.student.id,
                      editingCell.category.id,
                      customAmount
                    )
                  }
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition"
                >
                  Save Amount
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ENCRYPTED FINSEC ADMIN LOGIN */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden">
          <form
            onSubmit={handleAdminLogin}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400">
                <Lock className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">FinSec Admin Authorization</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Sign in with your Supabase Admin credentials to edit session dues, levies, and student payment records.
            </p>

            {authError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                {authError}
              </div>
            )}

            <div>
              <label className="text-xs text-slate-300">Admin Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full mt-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                required
              />
            </div>

            <div>
              <label className="text-xs text-slate-300">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full mt-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition"
            >
              Unlock FinSec Dashboard
            </button>
          </form>
        </div>
      )}
    </div>
  );
}