// buddy-stocks.tsx
// Full Buddy Stocks screen with:
// - robust Torn log detection (handles object-shaped responses)
// - 72-hour window enforcement
// - item dictionary caching via utils/tornItems (one-time fetch + AsyncStorage cache)
// - pretty formatted match lines like: "10:38:20 - 20/01/26 You were sent a Drug Pack from Memorium"
// - manual confirm flow, copy log, open profile, test API button
// - uses expo-clipboard, expo-secure-store, AsyncStorage, expo-router

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  Button,
  Alert,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Linking,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { loadItemDictionary, getItemName, clearItemCache } from "../utils/tornItems";

/* ============================
   Theme & types
   ============================ */

const THEME = {
  background: "#0f1724",
  surface: "#0b1226",
  card: "#0f1b2d",
  text: "#e6eef8",
  muted: "#9fb0d6",
  accent: "#1f6feb",
  danger: "#ff6b6b",
  inputBg: "#0b1226",
  inputBorder: "#22324a",
};

type InvestmentType = "stock" | "bank";

interface PaymentState {
  paymentNumber: number;
  amount: number; // cents
  paid: boolean;
  paidDate?: string | null;
  note?: string | null;
}

interface Buddy {
  id: string;
  buddyId: string;
  name: string;
  investmentType: InvestmentType;
  startDate?: string | null; // DD-MM-YYYY
  daysPerPayout: number;
  totalInvested: number; // cents
  payoutValue: number; // cents
  buddyPayout: number; // cents
  itemName?: string | null; // optional human name
  itemId?: number | null; // optional Torn item id for exact matching
  totalPayouts: number;
  paymentsState?: Record<number, PaymentState>;
  version?: number;
}

/* ============================
   Helpers (parsing, formatting)
   ============================ */

const STORAGE_KEY = "buddy:buddy-stocks:v1";
const DEFAULT_VERSION = 1;

const toNumber = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
};

const toInt = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  const n = parseInt(String(v).trim(), 10);
  return Number.isNaN(n) ? fallback : n;
};

const uid = (prefix = "b") => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const parseDDMMYYYY = (s?: string | null): Date | null => {
  if (!s) return null;
  const parts = s.split("-");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts.map((p) => parseInt(p, 10));
  if (!dd || !mm || !yyyy) return null;
  const d = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatCurrencyNoDecimals = (value: number) => {
  const dollars = Math.round(value / 100);
  return `$${Intl.NumberFormat("en-US").format(dollars)}`;
};

/* ============================
   Parsing helpers (suffixes)
   ============================ */

const parseSuffixNumber = (input: string): number => {
  if (!input && input !== "0") return 0;
  const s = String(input).trim().replace(/,/g, "");
  if (s === "") return 0;
  const match = s.match(/^(-?[\d,.]*\.?\d+)\s*([kKmMbBtT])?$/);
  if (!match) {
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  const numPart = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  if (!suffix) return Math.round(numPart);
  switch (suffix) {
    case "k":
      return Math.round(numPart * 1_000);
    case "m":
      return Math.round(numPart * 1_000_000);
    case "b":
      return Math.round(numPart * 1_000_000_000);
    case "t":
      return Math.round(numPart * 1_000_000_000_000);
    default:
      return Math.round(numPart);
  }
};

const parseCurrencyInput = (input: string | number | undefined): number => {
  if (input === undefined || input === null) return 0;
  if (typeof input === "number") return Math.round(input);
  const s = String(input).trim();
  if (s === "") return 0;
  if (s.includes(".")) {
    const n = Number(s.replace(/,/g, ""));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }
  const whole = parseSuffixNumber(s);
  return Math.round(whole * 100);
};

/* ============================
   Normalize & compute
   ============================ */

const normalizeBuddy = (raw: any): Buddy => {
  const b: Buddy = {
    id: String(raw?.id ?? uid("b")),
    buddyId: String(raw?.buddyId ?? raw?.id ?? ""),
    name: String(raw?.name ?? raw?.buddyName ?? "Unnamed"),
    investmentType: (raw?.investmentType as InvestmentType) ?? "stock",
    startDate: raw?.startDate ?? null,
    daysPerPayout: toInt(raw?.daysPerPayout, 0),
    totalInvested: toNumber(raw?.totalInvested, 0),
    payoutValue: toNumber(raw?.payoutValue, 0),
    buddyPayout: toNumber(raw?.buddyPayout, 0),
    itemName: raw?.itemName ?? null,
    itemId: raw?.itemId ? toInt(raw.itemId, 0) : null,
    totalPayouts: toInt(raw?.totalPayouts, 0),
    paymentsState: {},
    version: toInt(raw?.version, DEFAULT_VERSION),
  };

  if (raw?.paymentsState) {
    if (Array.isArray(raw.paymentsState)) {
      raw.paymentsState.forEach((p: any) => {
        const pn = toInt(p?.paymentNumber, 0);
        if (pn > 0) {
          b.paymentsState![pn] = {
            paymentNumber: pn,
            amount: toNumber(p?.amount, 0),
            paid: Boolean(p?.paid),
            paidDate: p?.paidDate ?? null,
            note: p?.note ?? null,
          };
        }
      });
    } else if (typeof raw.paymentsState === "object") {
      Object.entries(raw.paymentsState).forEach(([k, v]) => {
        const pn = toInt(k, 0);
        if (pn > 0 && v) {
          b.paymentsState![pn] = {
            paymentNumber: pn,
            amount: toNumber((v as any).amount, 0),
            paid: Boolean((v as any).paid),
            paidDate: (v as any).paidDate ?? null,
            note: (v as any).note ?? null,
          };
        }
      });
    }
  }

  return b;
};

const recomputeBuddy = (buddy: Buddy): Buddy => {
  const b = { ...buddy };
  b.daysPerPayout = toInt(b.daysPerPayout, 0);
  b.totalInvested = toNumber(b.totalInvested, 0);
  b.payoutValue = toNumber(b.payoutValue, 0);
  b.buddyPayout = toNumber(b.buddyPayout, 0);
  b.totalPayouts = toInt(b.totalPayouts, 0);

  b.paymentsState = b.paymentsState ?? {};
  const maxPayments = Math.max(0, b.totalPayouts);
  for (let i = 1; i <= Math.max(1, maxPayments); i++) {
    if (!b.paymentsState[i]) {
      const amount = Math.round(b.payoutValue);
      b.paymentsState[i] = { paymentNumber: i, amount, paid: false };
    } else {
      b.paymentsState[i].amount = toNumber(b.paymentsState[i].amount, b.payoutValue);
      b.paymentsState[i].paymentNumber = i;
    }
  }

  return b;
};

/* ============================
   Persistence
   ============================ */

const loadBuddies = async (): Promise<Buddy[]> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p: any) => recomputeBuddy(normalizeBuddy(p)));
  } catch (err) {
    console.warn("loadBuddies failed", err);
    return [];
  }
};

const saveBuddies = async (buddies: Buddy[]) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(buddies));
  } catch (err) {
    console.warn("saveBuddies failed", err);
    Alert.alert("Save failed", "Could not persist your buddies.");
  }
};

/* ============================
   Payments & ROI helpers (HOISTED)
   ============================ */

function computePayoutsPerWeek(buddies: Buddy[]) {
  let totalCents = 0;
  buddies.forEach((b) => {
    const bb = recomputeBuddy(b);
    if (bb.daysPerPayout > 0 && bb.payoutValue > 0) {
      const weekly = (bb.payoutValue * 7) / bb.daysPerPayout;
      totalCents += Math.round(weekly);
    }
  });
  return totalCents;
}

function computeAvgROI(buddies: Buddy[]) {
  if (!buddies.length) return { simpleAvg: 0, weightedAvg: 0 };
  const rois = buddies.map((b) => computeBuddyROI(b).roi);
  const simpleAvg = rois.reduce((s, r) => s + r, 0) / rois.length;

  const weighted = buddies.reduce(
    (acc, b) => {
      const r = computeBuddyROI(b);
      acc.weightedSum += r.roi * r.invested;
      acc.invested += r.invested;
      return acc;
    },
    { weightedSum: 0, invested: 0 }
  );
  const weightedAvg = weighted.invested === 0 ? 0 : weighted.weightedSum / weighted.invested;
  return { simpleAvg, weightedAvg };
}
// Hoisted computeBuddyROI (place this above computePortfolioOverview)
function computeBuddyROI(buddy: Buddy) {
  const b = recomputeBuddy(buddy);
  const received = Object.values(b.paymentsState ?? {}).reduce((sum, p) => sum + (p.paid ? p.amount : 0), 0);
  const invested = b.totalInvested;
  const roi = invested === 0 ? 0 : (received - invested) / invested;
  return { invested, received, roi };
}
function computePortfolioOverview(buddies: Buddy[]) {
  const totals = buddies.reduce(
    (acc, b) => {
      const r = computeBuddyROI(b);
      acc.invested += r.invested;
      acc.received += r.received;
      return acc;
    },
    { invested: 0, received: 0 }
  );
  const roi = totals.invested === 0 ? 0 : (totals.received - totals.invested) / totals.invested;
  return { ...totals, roi };
}

function nextPayouts(buddies: Buddy[], maxItems = 5) {
  const now = new Date();
  const upcoming: { buddyId: string; buddyName: string; paymentNumber: number; date: string; amount: number }[] = [];

  buddies.forEach((b) => {
    const bb = recomputeBuddy(b);
    const payments = generatePayments(bb, Math.max(1, bb.totalPayouts || 0));
    payments.forEach((p) => {
      if (!p.paid && p.paidDate) {
        const date = new Date(p.paidDate);
        if (date >= now) {
          upcoming.push({
            buddyId: bb.id,
            buddyName: bb.name,
            paymentNumber: p.paymentNumber,
            date: p.paidDate,
            amount: p.amount,
          });
        }
      }
    });
  });

  upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return upcoming.slice(0, maxItems);
}
// Hoisted generatePayments - place this above the BuddyStocksScreen component
function generatePayments(buddy: Buddy, maxPayments = 200): PaymentState[] {
  const b = recomputeBuddy(buddy);
  const total = b.totalPayouts > 0 ? Math.min(maxPayments, b.totalPayouts) : maxPayments;
  const payments: PaymentState[] = [];
  const startDate = parseDDMMYYYY(b.startDate ?? null);

  for (let i = 1; i <= total; i++) {
    const amount = Math.round(b.payoutValue);
    const base: PaymentState = {
      paymentNumber: i,
      amount,
      paid: Boolean(b.paymentsState?.[i]?.paid ?? false),
      paidDate: b.paymentsState?.[i]?.paidDate ?? null,
      note: b.paymentsState?.[i]?.note ?? null,
    };

    if (startDate && b.daysPerPayout > 0) {
      const date = new Date(startDate.getTime());
      date.setDate(date.getDate() + i * b.daysPerPayout);
      base.paidDate = base.paidDate ?? date.toISOString();
    }

    payments.push(base);
  }

  return payments;
}
function computeNextPayoutForBuddy(buddy: Buddy) {
  const payments = generatePayments(buddy, 200);
  const now = new Date();
  for (const p of payments) {
    if (!p.paid && p.paidDate) {
      const scheduled = new Date(p.paidDate);
      if (scheduled >= now) {
        const diffMs = scheduled.getTime() - now.getTime();
        const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        return { paymentNumber: p.paymentNumber, dateISO: p.paidDate, daysUntil: days, amount: p.amount };
      }
    }
  }
  return null;
}

function roiDaysUntilBreakEven(buddy: Buddy) {
  const b = recomputeBuddy(buddy);
  const invested = b.totalInvested;
  if (invested <= 0) return { daysUntilBreakEven: 0, paymentNumber: 0, breakEvenDate: null };

  const payments = generatePayments(b, Math.max(1, b.totalPayouts || 0));
  const start = parseDDMMYYYY(b.startDate ?? null);
  let cumulative = 0;
  for (let i = 0; i < payments.length; i++) {
    cumulative += payments[i].amount;
    if (cumulative >= invested) {
      let scheduled: Date | null = null;
      if (payments[i].paidDate) scheduled = new Date(payments[i].paidDate);
      else if (start && b.daysPerPayout > 0) {
        scheduled = new Date(start.getTime());
        scheduled.setDate(scheduled.getDate() + (i + 1) * b.daysPerPayout);
      }
      const now = new Date();
      if (!scheduled) return { daysUntilBreakEven: null, paymentNumber: i + 1, breakEvenDate: null };
      const diffMs = scheduled.getTime() - now.getTime();
      const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      return { daysUntilBreakEven: days, paymentNumber: i + 1, breakEvenDate: scheduled.toISOString() };
    }
  }
  return { daysUntilBreakEven: null, paymentNumber: null, breakEvenDate: null };
}

/* ============================
   Torn API helpers (log fetch + detection)
   ============================ */

const fetchTornLogForBuddy = async (apiKey: string, logId: number) => {
  if (!apiKey) throw new Error("API key required");
  const url = `https://api.torn.com/user/?key=${encodeURIComponent(apiKey)}&log=${encodeURIComponent(String(logId))}&comment=TornAPI&selections=log`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Torn API error ${res.status}`);
  return res.json();
};

/**
 * detectMatchesInLog
 * - buddy: Buddy
 * - logData: Torn log JSON (array or object)
 * - itemDict: optional item dictionary (id -> metadata) for name lookup
 * Returns: array of matches with formatted string and metadata
 */
const detectMatchesInLog = (buddy: Buddy, logData: any, itemDict?: Record<string, any>) => {
  // Normalize entries: Torn sometimes returns an object keyed by random ids
  let entries: any[] = [];
  if (Array.isArray(logData?.log)) entries = logData.log;
  else if (Array.isArray(logData?.logs)) entries = logData.logs;
  else if (Array.isArray(logData)) entries = logData;
  else if (logData && typeof logData === "object") {
    // If the response is an object with nested logs, collect values that look like log entries
    entries = Object.values(logData).filter((v) => v && (v.log || v.title || v.timestamp));
  }

  const matches: {
    type: "item" | "money" | "other";
    text: string;
    amount?: number;
    itemId?: number;
    qty?: number;
    timestamp?: number;
    raw?: any;
    reason: string;
    formatted?: string;
    senderId?: number;
    receiverId?: number;
  }[] = [];

  const b = recomputeBuddy(buddy);
  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = 72 * 3600; // 72 hours

  const fmtTime = (tsSec?: number) => {
    if (!tsSec) return "";
    const d = new Date(tsSec * 1000);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear()).slice(-2);
    return `${hh}:${mm}:${ss} - ${day}/${month}/${year}`;
  };

  for (const entry of entries) {
    const ts = toInt(entry?.timestamp, 0);
    if (!ts) continue;

    // enforce 72-hour window (only past entries within window)
    if (ts > nowSec) continue; // ignore future timestamps
    if (nowSec - ts > windowSec) continue;

    const title = String(entry?.title ?? "").toLowerCase();
    const category = String(entry?.category ?? "").toLowerCase();
    const text = String(entry?.text ?? entry?.description ?? "");
    const textLower = text.toLowerCase();

    // Money transfers
    const amountRaw = entry?.amount ?? entry?.data?.amount ?? 0;
    const amountCents = Math.round(Number(amountRaw) * 100);

    // Item sending/receiving
    const data = entry?.data ?? {};
    const items = Array.isArray(data?.items) ? data.items : [];

    const sender = toInt(data?.sender ?? entry?.sender ?? 0, 0);
    const receiver = toInt(data?.receiver ?? entry?.receiver ?? 0, 0);
    const buddyIdNum = toInt(b.buddyId ?? 0, 0);

    const buildFormatted = (tsSec: number, verb: string, subject: string, fromTo?: string) => {
      const time = fmtTime(tsSec);
      const fromToPart = fromTo ? ` ${fromTo}` : "";
      return `${time} ${verb} ${subject}${fromToPart}`;
    };

    // 1) Money match (exact amount)
    if (amountCents > 0 && b.payoutValue > 0 && Math.round(amountCents) === Math.round(b.payoutValue)) {
      const involvesBuddy = sender === buddyIdNum || receiver === buddyIdNum || textLower.includes(String(buddyIdNum));
      if (involvesBuddy) {
        const verb = receiver === buddyIdNum ? "You received" : sender === buddyIdNum ? "You sent" : "Money transfer";
        const fromTo = sender === buddyIdNum ? `to ${receiver}` : receiver === buddyIdNum ? `from ${sender}` : `(${sender}→${receiver})`;
        const formatted = buildFormatted(ts, verb, `$${(amountCents / 100).toFixed(2)}`, fromTo);
        matches.push({
          type: "money",
          text,
          amount: amountCents,
          timestamp: ts,
          raw: entry,
          reason: "amount match and buddy involved",
          formatted,
          senderId: sender,
          receiverId: receiver,
        });
        continue;
      }
    }

    // 2) Item match (prefer exact itemId if buddy.itemId set)
    if (items.length > 0) {
      for (const it of items) {
        const itemId = toInt(it?.id, 0);
        const qty = toInt(it?.qty, 0);
        const buddyItemId = b.itemId ? toInt(b.itemId, 0) : 0;
        const involvesBuddy = sender === buddyIdNum || receiver === buddyIdNum || textLower.includes(String(buddyIdNum));

        // exact id match if buddy.itemId provided
        if (buddyItemId && itemId === buddyItemId && involvesBuddy) {
          const verb = receiver === buddyIdNum ? "You were sent" : sender === buddyIdNum ? "You sent" : "Item transfer";
          const itemName = (itemDict && itemDict[String(itemId)]?.name) ?? b.itemName ?? `Item ID ${itemId}`;
          const subject = `${itemName}${qty > 1 ? ` x${qty}` : ""}`;
          const fromTo = receiver === buddyIdNum ? `from ${sender}` : sender === buddyIdNum ? `to ${receiver}` : `(${sender}→${receiver})`;
          const formatted = buildFormatted(ts, verb, subject, fromTo);
          matches.push({
            type: "item",
            text,
            itemId,
            qty,
            timestamp: ts,
            raw: entry,
            reason: "item id match and buddy involved",
            formatted,
            senderId: sender,
            receiverId: receiver,
          });
          break;
        }

        // fallback: match by buddy.itemName substring if provided
        if (!buddyItemId && b.itemName) {
          const itemNameLower = String(b.itemName).toLowerCase();
          if (textLower.includes(itemNameLower) && involvesBuddy) {
            const verb = receiver === buddyIdNum ? "You were sent" : sender === buddyIdNum ? "You sent" : "Item transfer";
            const itemName = (itemDict && itemDict[String(itemId)]?.name) ?? b.itemName;
            const subject = `${itemName}${qty > 1 ? ` x${qty}` : ""}`;
            const fromTo = receiver === buddyIdNum ? `from ${sender}` : sender === buddyIdNum ? `to ${receiver}` : `(${sender}→${receiver})`;
            const formatted = buildFormatted(ts, verb, subject, fromTo);
            matches.push({
              type: "item",
              text,
              itemId,
              qty,
              timestamp: ts,
              raw: entry,
              reason: "item name substring match and buddy involved",
              formatted,
              senderId: sender,
              receiverId: receiver,
            });
            break;
          }
        }
      }
      // continue to next entry after processing items
      continue;
    }

    // 3) Fallback: explicit item receive/send title and buddy involved
    if ((title.includes("item receive") || title.includes("item send") || category.includes("item sending"))) {
      if (sender === buddyIdNum || receiver === buddyIdNum || textLower.includes(String(buddyIdNum))) {
        const verb = title.includes("receive") || receiver === buddyIdNum ? "You were sent" : title.includes("send") || sender === buddyIdNum ? "You sent" : "Item transfer";
        let subject = "an item";
        if (items.length > 0) {
          const it = items[0];
          const itemId = toInt(it?.id, 0);
          const qty = toInt(it?.qty, 0);
          const itemName = (itemDict && itemDict[String(itemId)]?.name) ?? b.itemName ?? `Item ID ${itemId}`;
          subject = `${itemName}${qty > 1 ? ` x${qty}` : ""}`;
        }
        const fromTo = receiver === buddyIdNum ? `from ${sender}` : sender === buddyIdNum ? `to ${receiver}` : `(${sender}→${receiver})`;
        const formatted = buildFormatted(ts, verb, subject, fromTo);
        matches.push({
          type: "item",
          text,
          timestamp: ts,
          raw: entry,
          reason: "explicit item receive/send title and buddy involved",
          formatted,
          senderId: sender,
          receiverId: receiver,
        });
        continue;
      }
    }
  }

  return matches;
};

/* ============================
   Hook: useBuddyManager
   ============================ */

const useBuddyManager = () => {
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const loaded = await loadBuddies();
      setBuddies(loaded);
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(
    async (next: Buddy[]) => {
      setBuddies(next);
      await saveBuddies(next);
    },
    [setBuddies]
  );

  const addOrUpdateBuddy = useCallback(
    async (incoming: Partial<Buddy>) => {
      const normalized = normalizeBuddy(incoming);
      const recomputed = recomputeBuddy(normalized);
      const next = [...buddies.filter((s) => s.id !== recomputed.id), recomputed];
      await persist(next);
    },
    [buddies, persist]
  );

  const removeBuddy = useCallback(
    async (id: string) => {
      const next = buddies.filter((b) => b.id !== id);
      await persist(next);
    },
    [buddies, persist]
  );

  const updateBuddy = useCallback(
    async (updated: Buddy) => {
      const next = buddies.map((b) => (b.id === updated.id ? recomputeBuddy(updated) : b));
      await persist(next);
    },
    [buddies, persist]
  );

  return {
    buddies,
    loading,
    addOrUpdateBuddy,
    removeBuddy,
    updateBuddy,
    setBuddies,
  };
};

/* ============================
   UI components & main screen
   ============================ */

const FieldLabel: React.FC<{ label: string; hint?: string }> = ({ label, hint }) => (
  <View style={{ marginBottom: 6 }}>
    <Text style={{ color: THEME.text, fontWeight: "700" }}>{label}</Text>
    {hint ? <Text style={{ color: THEME.muted, fontSize: 12 }}>{hint}</Text> : null}
  </View>
);

const BuddyStocksScreen: React.FC = () => {
  const router = useRouter();
  const { buddies, loading, addOrUpdateBuddy, removeBuddy, updateBuddy } = useBuddyManager();

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    buddyId: "",
    investmentType: "stock" as InvestmentType,
    startDate: "",
    daysPerPayout: "",
    totalInvestedStr: "",
    payoutValueStr: "",
    buddyPayoutStr: "",
    itemName: "",
    itemIdStr: "",
    totalPayoutsStr: "",
  });

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleBuddy, setScheduleBuddy] = useState<Buddy | null>(null);

  // Torn fetch state for schedule modal
  const [tornLogId, setTornLogId] = useState("4103");
  const [tornMatches, setTornMatches] = useState<any[]>([]);
  const [fetchingTorn, setFetchingTorn] = useState(false);
  const [itemDict, setItemDict] = useState<Record<string, any> | null>(null);

  const overview = useMemo(() => computePortfolioOverview(buddies), [buddies]);
  const payoutsWeek = useMemo(() => computePayoutsPerWeek(buddies), [buddies]);
  const avgROI = useMemo(() => computeAvgROI(buddies), [buddies]);
  const upcoming = useMemo(() => nextPayouts(buddies, 5), [buddies]);
  const portfolioNext = useMemo(() => (upcoming.length ? upcoming[0] : null), [upcoming]);

  const openAdd = () => {
    setForm({
      id: uid("b"),
      name: "",
      buddyId: "",
      investmentType: "stock",
      startDate: "",
      daysPerPayout: "",
      totalInvestedStr: "",
      payoutValueStr: "",
      buddyPayoutStr: "",
      itemName: "",
      itemIdStr: "",
      totalPayoutsStr: "",
    });
    setModalOpen(true);
  };

  const openEdit = (b: Buddy) => {
    setForm({
      id: b.id,
      name: b.name,
      buddyId: b.buddyId,
      investmentType: b.investmentType,
      startDate: b.startDate ?? "",
      daysPerPayout: String(b.daysPerPayout ?? ""),
      totalInvestedStr: b.totalInvested ? String(Math.round(b.totalInvested / 100)) : "",
      payoutValueStr: b.payoutValue ? String(Math.round(b.payoutValue / 100)) : "",
      buddyPayoutStr: b.buddyPayout ? String(Math.round(b.buddyPayout / 100)) : "",
      itemName: b.itemName ?? "",
      itemIdStr: b.itemId ? String(b.itemId) : "",
      totalPayoutsStr: String(b.totalPayouts ?? ""),
    });
    setModalOpen(true);
  };

  const saveEditing = async () => {
    if (!form.name.trim()) {
      Alert.alert("Validation", "Buddy name is required.");
      return;
    }

    const totalInvestedCents = parseCurrencyInput(form.totalInvestedStr);
    const payoutValueCents = parseCurrencyInput(form.payoutValueStr);
    const buddyPayoutCents = parseCurrencyInput(form.buddyPayoutStr);
    const daysPerPayout = toInt(form.daysPerPayout, 0);
    const totalPayouts = toInt(form.totalPayoutsStr, 0);
    const itemId = form.itemIdStr ? toInt(form.itemIdStr, 0) : null;

    const toSave: Partial<Buddy> = {
      id: form.id,
      name: form.name.trim(),
      buddyId: form.buddyId.trim(),
      investmentType: form.investmentType,
      startDate: form.startDate || null,
      daysPerPayout,
      totalInvested: totalInvestedCents,
      payoutValue: payoutValueCents,
      buddyPayout: buddyPayoutCents,
      itemName: form.itemName || null,
      itemId,
      totalPayouts,
    };

    await addOrUpdateBuddy(toSave);
    setModalOpen(false);
  };

  const openSchedule = async (b: Buddy) => {
    setScheduleBuddy(b);
    setTornMatches([]);
    setTornLogId("4103");
    setScheduleOpen(true);

    // load item dictionary once (if API key present)
    try {
      const savedKey = await SecureStore.getItemAsync("torn_api_key");
      if (savedKey) {
        const dict = await loadItemDictionary(savedKey);
        setItemDict(dict && Object.keys(dict).length ? dict : null);
      } else {
        setItemDict(null);
      }
    } catch (err) {
      setItemDict(null);
    }
  };

  const handleMarkPaid = async (b: Buddy, paymentNumber: number) => {
    const updated = markPaymentPaid(b, paymentNumber, true);
    await updateBuddy(updated);
  };

  const handleMarkUnpaid = async (b: Buddy, paymentNumber: number) => {
    const updated = markPaymentPaid(b, paymentNumber, false);
    await updateBuddy(updated);
  };

  /* ---------------------------
     Torn log fetch + detection (reads API key from SecureStore)
     --------------------------- */

  const handleFetchTornLogs = async () => {
    if (!scheduleBuddy) return;
    setFetchingTorn(true);
    try {
      const savedKey = await SecureStore.getItemAsync("torn_api_key");
      if (!savedKey) {
        Alert.alert(
          "API key missing",
          "No Torn API key found. Open Settings to add your API key.",
          [{ text: "Open Settings", onPress: () => router.push("/settings") }, { text: "OK", style: "cancel" }]
        );
        setFetchingTorn(false);
        return;
      }

      // ensure item dictionary loaded
      if (!itemDict) {
        const dict = await loadItemDictionary(savedKey);
        setItemDict(dict && Object.keys(dict).length ? dict : null);
      }

      const logIdNum = toInt(tornLogId, 4103);
      const data = await fetchTornLogForBuddy(savedKey, logIdNum);
      const matches = detectMatchesInLog(scheduleBuddy, data, itemDict ?? undefined);
      setTornMatches(matches);
      if (matches.length === 0) Alert.alert("No matches", "No likely payouts detected in the provided log (72h window).");
    } catch (err: any) {
      Alert.alert("Fetch failed", String(err?.message ?? err));
    } finally {
      setFetchingTorn(false);
    }
  };

  /* ---------------------------
     Test API button (quick test)
     --------------------------- */

  const handleTestApi = async () => {
    if (!scheduleBuddy) {
      Alert.alert("Select a buddy", "Open a buddy schedule first to test the API.");
      return;
    }
    setFetchingTorn(true);
    try {
      const savedKey = await SecureStore.getItemAsync("torn_api_key");
      if (!savedKey) {
        Alert.alert("API key missing", "No Torn API key found. Open Settings to add your API key.", [
          { text: "Open Settings", onPress: () => router.push("/settings") },
          { text: "Cancel", style: "cancel" },
        ]);
        setFetchingTorn(false);
        return;
      }

      // quick fetch to verify logs accessible
      const logIdNum = toInt(tornLogId, 4103);
      const data = await fetchTornLogForBuddy(savedKey, logIdNum);
      const matches = detectMatchesInLog(scheduleBuddy, data, itemDict ?? undefined);
      Alert.alert("API test", `Fetched log ${logIdNum}. Detected ${matches.length} candidate match(es).`);
    } catch (err: any) {
      Alert.alert("API test failed", String(err?.message ?? err));
    } finally {
      setFetchingTorn(false);
    }
  };

  /* ---------------------------
     Copy & open profile helper
     --------------------------- */

  const copyAmountAndOpenProfile = async (buddy: Buddy, amountCents: number) => {
    const dollars = (amountCents / 100).toFixed(2);
    await Clipboard.setStringAsync(dollars);
    const profileUrl = `https://www.torn.com/profiles.php?XID=${encodeURIComponent(buddy.buddyId)}`;
    Linking.openURL(profileUrl).catch(() => {
      Alert.alert("Open failed", "Could not open profile URL.");
    });
  };

  const copyLogToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert("Copied", "Log copied to clipboard.");
  };

  /* ---------------------------
     UI rendering
     --------------------------- */

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: THEME.background }]}>
        <Text style={{ color: THEME.text }}>Loading buddies…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: THEME.background }]}>
      <FlatList
        data={buddies.sort((a, b) => a.name.localeCompare(b.name))}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={
          <>
            <Text style={[styles.header, { color: THEME.text }]}>Buddy Stocks</Text>

            <View style={styles.overviewRow}>
              <View style={[styles.card, { backgroundColor: THEME.card }]}>
                <Text style={[styles.cardTitle, { color: THEME.muted }]}>Total Invested</Text>
                <Text style={[styles.cardValue, { color: THEME.text }]}>{formatCurrencyNoDecimals(overview.invested)}</Text>
              </View>
              <View style={[styles.card, { backgroundColor: THEME.card }]}>
                <Text style={[styles.cardTitle, { color: THEME.muted }]}>Total Received</Text>
                <Text style={[styles.cardValue, { color: THEME.text }]}>{formatCurrencyNoDecimals(overview.received)}</Text>
              </View>
              <View style={[styles.card, { backgroundColor: THEME.card }]}>
                <Text style={[styles.cardTitle, { color: THEME.muted }]}>Payouts / week</Text>
                <Text style={[styles.cardValue, { color: THEME.text }]}>{formatCurrencyNoDecimals(payoutsWeek)}</Text>
              </View>
            </View>

            <View style={styles.overviewRow}>
              <View style={[styles.card, { backgroundColor: THEME.card }]}>
                <Text style={[styles.cardTitle, { color: THEME.muted }]}>Avg ROI (simple)</Text>
                <Text style={[styles.cardValue, { color: THEME.text }]}>{(avgROI.simpleAvg * 100).toFixed(1)}%</Text>
              </View>
              <View style={[styles.card, { backgroundColor: THEME.card }]}>
                <Text style={[styles.cardTitle, { color: THEME.muted }]}>Avg ROI (weighted)</Text>
                <Text style={[styles.cardValue, { color: THEME.text }]}>{(avgROI.weightedAvg * 100).toFixed(1)}%</Text>
              </View>
              <View style={[styles.card, { backgroundColor: THEME.card }]}>
                <Text style={[styles.cardTitle, { color: THEME.muted }]}>Next payout (portfolio)</Text>
                {portfolioNext ? (
                  <View>
                    <Text style={[styles.cardValue, { color: THEME.text }]}>{portfolioNext.buddyName}</Text>
                    <Text style={{ color: THEME.muted, fontSize: 12 }}>{new Date(portfolioNext.date).toLocaleDateString()}</Text>
                  </View>
                ) : (
                  <Text style={[styles.cardValue, { color: THEME.muted }]}>None</Text>
                )}
              </View>
            </View>

            <View style={{ marginTop: 12 }}>
              <Pressable style={[styles.addButton, { backgroundColor: THEME.accent }]} onPress={() => openAdd()}>
                <Text style={styles.addButtonText}>Add Buddy</Text>
              </Pressable>
            </View>

            <Text style={[styles.sectionTitle, { color: THEME.text }]}>Buddies</Text>
          </>
        }
        renderItem={({ item }) => {
          const r = computeBuddyROI(item);
          const next = computeNextPayoutForBuddy(item);
          const breakInfo = roiDaysUntilBreakEven(item);
          return (
            <View style={[styles.buddyRow, { borderBottomColor: "#122033" }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.buddyName, { color: THEME.text }]}>{item.name}</Text>
                <Text style={[styles.buddyMeta, { color: THEME.muted }]}>
                  {item.investmentType} • Item: {item.itemName ?? "—"}
                </Text>

                {next ? (
                  <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 6 }}>
                    Next payout: {new Date(next.dateISO).toLocaleDateString()} ({next.daysUntil} days)
                  </Text>
                ) : (
                  <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 6 }}>Next payout: N/A</Text>
                )}

                <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 4 }}>
                  Break-even in: {breakInfo.daysUntilBreakEven === null ? "N/A" : `${breakInfo.daysUntilBreakEven} days`}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.buddyValue, { color: THEME.text }]}>{formatCurrencyNoDecimals(item.totalInvested)}</Text>
                <Text style={[styles.buddyROI, { color: THEME.accent }]}>{(r.roi * 100).toFixed(1)}%</Text>
                <View style={{ flexDirection: "row", marginTop: 6 }}>
                  <Pressable style={styles.smallBtn} onPress={() => openSchedule(item)}>
                    <Text style={styles.smallBtnText}>Schedule</Text>
                  </Pressable>
                  <Pressable style={[styles.smallBtn, { marginLeft: 8 }]} onPress={() => openEdit(item)}>
                    <Text style={styles.smallBtnText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallBtn, { marginLeft: 8, backgroundColor: THEME.danger }]}
                    onPress={() =>
                      Alert.alert("Remove buddy", "Are you sure?", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: async () => {
                            await removeBuddy(item.id);
                          },
                        },
                      ])
                    }
                  >
                    <Text style={styles.smallBtnText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={{ padding: 12, color: THEME.muted }}>No buddies yet. Add one to get started.</Text>}
        initialNumToRender={10}
        contentContainerStyle={{ paddingBottom: 40 }}
      />

      {/* Add/Edit Modal */}
      <Modal visible={modalOpen} animationType="slide" onRequestClose={() => setModalOpen(false)} transparent={false}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[styles.modal, { backgroundColor: THEME.surface }]} keyboardShouldPersistTaps="handled">
            <Text style={[styles.modalHeader, { color: THEME.text }]}>{form.id ? "Edit Buddy" : "Add Buddy"}</Text>

            <FieldLabel label="Buddy name" hint="A friendly name to identify this buddy (required)" />
            <TextInput placeholder="e.g., Alice - Market" placeholderTextColor={THEME.muted} value={form.name} onChangeText={(t) => setForm((s) => ({ ...s, name: t }))} style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Buddy ID" hint="Game ID or unique identifier (optional, helps auto-detect)" />
            <TextInput placeholder="e.g., 123456" placeholderTextColor={THEME.muted} value={form.buddyId} onChangeText={(t) => setForm((s) => ({ ...s, buddyId: t }))} style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Investment type" hint="Stock = item; Bank = money" />
            <View style={{ flexDirection: "row", marginBottom: 8 }}>
              <Pressable style={[styles.typeBtn, form.investmentType === "stock" ? styles.typeBtnActive : null]} onPress={() => setForm((s) => ({ ...s, investmentType: "stock" }))}>
                <Text style={form.investmentType === "stock" ? styles.typeBtnTextActive : styles.typeBtnText}>Stock (item)</Text>
              </Pressable>
              <Pressable style={[styles.typeBtn, form.investmentType === "bank" ? styles.typeBtnActive : null, { marginLeft: 8 }]} onPress={() => setForm((s) => ({ ...s, investmentType: "bank" }))}>
                <Text style={form.investmentType === "bank" ? styles.typeBtnTextActive : styles.typeBtnText}>Bank (money)</Text>
              </Pressable>
            </View>

            <FieldLabel label="Start date" hint="First expected payout. Format: DD-MM-YYYY" />
            <TextInput placeholder="DD-MM-YYYY" placeholderTextColor={THEME.muted} value={form.startDate} onChangeText={(t) => setForm((s) => ({ ...s, startDate: t }))} style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Days per payout" hint="How often they send payouts (7 = weekly, 30 = monthly)" />
            <TextInput placeholder="e.g., 7" placeholderTextColor={THEME.muted} value={form.daysPerPayout} onChangeText={(t) => setForm((s) => ({ ...s, daysPerPayout: t }))} keyboardType="numeric" style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Total invested (you)" hint="Enter decimals (12.34) or suffixes (1k, 1M). Will convert to cents." />
            <TextInput placeholder="e.g., 12.34 or 1k" placeholderTextColor={THEME.muted} value={form.totalInvestedStr} onChangeText={(t) => setForm((s) => ({ ...s, totalInvestedStr: t }))} keyboardType={Platform.OS === "ios" ? "decimal-pad" : "default"} style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Payout value (to you)" hint="Amount you receive each payout. Accepts decimals or suffixes." />
            <TextInput placeholder="e.g., 1.23 or 1k" placeholderTextColor={THEME.muted} value={form.payoutValueStr} onChangeText={(t) => setForm((s) => ({ ...s, payoutValueStr: t }))} keyboardType={Platform.OS === "ios" ? "decimal-pad" : "default"} style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Buddy payout (to them)" hint="If you pay them per cycle, enter amount (optional)." />
            <TextInput placeholder="e.g., 0.50" placeholderTextColor={THEME.muted} value={form.buddyPayoutStr} onChangeText={(t) => setForm((s) => ({ ...s, buddyPayoutStr: t }))} keyboardType={Platform.OS === "ios" ? "decimal-pad" : "default"} style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Item name (optional)" hint="If they send an item, enter its name to help auto-detect in Torn logs." />
            <TextInput placeholder="e.g., Drug Pack" placeholderTextColor={THEME.muted} value={form.itemName} onChangeText={(t) => setForm((s) => ({ ...s, itemName: t }))} style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Item ID (optional)" hint="Torn item ID (preferred for exact matching). Example: 370" />
            <TextInput placeholder="e.g., 370" placeholderTextColor={THEME.muted} value={form.itemIdStr} onChangeText={(t) => setForm((s) => ({ ...s, itemIdStr: t }))} keyboardType="numeric" style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <FieldLabel label="Total payouts (optional)" hint="How many payouts you expect in total. Leave blank or 0 for ongoing." />
            <TextInput placeholder="e.g., 12" placeholderTextColor={THEME.muted} value={form.totalPayoutsStr} onChangeText={(t) => setForm((s) => ({ ...s, totalPayoutsStr: t }))} keyboardType="numeric" style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]} />

            <View style={{ marginTop: 8 }}>
              <Text style={{ color: THEME.muted, fontSize: 13 }}>
                Tips: use `k`, `M`, `b` suffixes (e.g., 1k = 1,000). For money, decimals are allowed (e.g., 1.23).
              </Text>
            </View>

            <View style={{ height: 16 }} />
            <View style={styles.modalButtons}>
              <Button title="Cancel" onPress={() => setModalOpen(false)} color={THEME.danger} />
              <Button title="Save" onPress={saveEditing} color={THEME.accent} />
            </View>
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Schedule Modal */}
      <Modal visible={scheduleOpen} animationType="slide" onRequestClose={() => setScheduleOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[styles.modal, { backgroundColor: THEME.surface }]} keyboardShouldPersistTaps="handled">
            <Text style={[styles.modalHeader, { color: THEME.text }]}>Payment Schedule</Text>

            {scheduleBuddy ? (
              <>
                <Text style={{ color: THEME.muted, marginBottom: 8 }}>{scheduleBuddy.name} — {scheduleBuddy.itemName ?? "No item"}</Text>

                <Text style={{ color: THEME.muted, fontSize: 12, marginBottom: 8 }}>
                  API key: read from Settings (open Settings to change)
                </Text>

                {/* Quick action: copy amount & open profile */}
                <View style={{ flexDirection: "row", marginBottom: 8 }}>
                  <Pressable style={[styles.addButton, { flex: 1, marginRight: 8, backgroundColor: THEME.accent }]} onPress={() => copyAmountAndOpenProfile(scheduleBuddy, scheduleBuddy.payoutValue)}>
                    <Text style={styles.addButtonText}>Copy Amount & Open Profile</Text>
                  </Pressable>
                  <Pressable style={[styles.addButton, { flex: 1, backgroundColor: "#2b394f" }]} onPress={() => {
                    Alert.alert("Schedule", "Scroll down to see scheduled payments and detected logs.");
                  }}>
                    <Text style={styles.addButtonText}>View Schedule</Text>
                  </Pressable>
                </View>

                {/* Torn log controls */}
                <Text style={{ color: THEME.muted, marginTop: 8 }}>Torn log ID</Text>
                <TextInput
                  placeholder="Log ID (e.g., 4103)"
                  placeholderTextColor={THEME.muted}
                  value={tornLogId}
                  onChangeText={setTornLogId}
                  keyboardType="numeric"
                  style={[styles.input, { backgroundColor: THEME.inputBg, borderColor: THEME.inputBorder, color: THEME.text }]}
                />

                <View style={{ flexDirection: "row", marginBottom: 12 }}>
                  <Button title={fetchingTorn ? "Fetching…" : "Fetch Torn logs"} onPress={handleFetchTornLogs} color={THEME.accent} />
                  <View style={{ width: 12 }} />
                  <Button title="Clear matches" onPress={() => setTornMatches([])} color="#2b394f" />
                  <View style={{ width: 12 }} />
                  <Button title="Open Settings" onPress={() => router.push("/settings")} color="#2b394f" />
                </View>

                {/* Test API button */}
                <View style={{ marginBottom: 12 }}>
                  <Button title="Test API (quick)" onPress={handleTestApi} color="#4caf50" />
                </View>

                {/* Detected matches (manual confirm) */}
                <Text style={{ color: THEME.muted, marginBottom: 6 }}>Detected log matches (manual confirm)</Text>
                {tornMatches.length === 0 ? (
                  <Text style={{ color: THEME.muted, marginBottom: 12 }}>No matches yet. Fetch logs to detect candidate payouts (72h window).</Text>
                ) : (
                  tornMatches.map((m, i) => (
                    <View key={i} style={{ marginBottom: 10, padding: 10, backgroundColor: "#07101a", borderRadius: 8 }}>
                      {/* Pretty formatted line */}
                      <Text style={{ color: THEME.text, fontWeight: "700", marginBottom: 6 }}>
                        {m.formatted ?? (m.timestamp ? new Date((m.timestamp as number) * 1000).toLocaleString() : "")}
                      </Text>

                      {/* Secondary details */}
                      <Text style={{ color: THEME.muted, fontSize: 12, marginBottom: 8 }}>
                        {m.reason}
                        {m.itemId ? ` • Item ID: ${m.itemId}${m.qty ? ` x${m.qty}` : ""}` : ""}
                        {m.amount ? ` • Amount: $${(m.amount / 100).toFixed(2)}` : ""}
                      </Text>

                      <Text style={{ color: THEME.muted, fontSize: 12, marginBottom: 8 }}>{m.text}</Text>

                      <View style={{ flexDirection: "row" }}>
                        <Pressable style={[styles.smallBtn, { marginRight: 8 }]} onPress={() => copyLogToClipboard(m.text)}>
                          <Text style={styles.smallBtnText}>Copy log</Text>
                        </Pressable>

                        <Pressable style={[styles.smallBtn, { marginRight: 8 }]} onPress={() => {
                          const profileUrl = `https://www.torn.com/profiles.php?XID=${encodeURIComponent(scheduleBuddy.buddyId)}`;
                          Linking.openURL(profileUrl).catch(() => Alert.alert("Open failed", "Could not open profile URL."));
                        }}>
                          <Text style={styles.smallBtnText}>Open profile</Text>
                        </Pressable>

                        <Pressable style={[styles.smallBtn, { backgroundColor: THEME.accent }]} onPress={async () => {
                          const payments = generatePayments(scheduleBuddy, 200);
                          const nextUnpaid = payments.find((p) => !p.paid);
                          if (!nextUnpaid) {
                            Alert.alert("No unpaid payments", "No unpaid scheduled payments to mark.");
                            return;
                          }
                          const updated = markPaymentPaid(scheduleBuddy, nextUnpaid.paymentNumber, true);
                          await updateBuddy(updated);
                          Alert.alert("Marked", `Payment #${nextUnpaid.paymentNumber} marked as paid.`);
                        }}>
                          <Text style={[styles.smallBtnText, { color: "#fff" }]}>Mark as paid</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}

                {/* Scheduled payments list (map) */}
                <Text style={{ color: THEME.muted, marginTop: 12, marginBottom: 6 }}>Scheduled payments</Text>
                {generatePayments(scheduleBuddy, 200).map((p) => (
                  <View key={p.paymentNumber} style={styles.paymentRow}>
                    <Text style={{ width: 48, color: THEME.text }}>#{p.paymentNumber}</Text>
                    <Text style={{ flex: 1, color: THEME.text }}>{formatCurrencyNoDecimals(p.amount)}</Text>
                    <Text style={{ width: 120, color: THEME.muted }}>{p.paid ? "Paid" : "Pending"}</Text>
                    {!p.paid ? (
                      <TouchableOpacity onPress={async () => {
                        copyAmountAndOpenProfile(scheduleBuddy, p.amount);
                      }}>
                        <Text style={{ color: THEME.accent }}>Copy & Open</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity onPress={async () => {
                        const updated = markPaymentPaid(scheduleBuddy, p.paymentNumber, false);
                        await updateBuddy(updated);
                      }}>
                        <Text style={{ color: THEME.danger }}>Unmark</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                <View style={{ marginTop: 12 }}>
                  <Button title="Close" onPress={() => setScheduleOpen(false)} color={THEME.accent} />
                </View>
              </>
            ) : (
              <Text style={{ color: THEME.muted }}>No buddy selected</Text>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

export default BuddyStocksScreen;

/* ============================
   Styles
   ============================ */

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { fontSize: 22, fontWeight: "700", margin: 16 },
  overviewRow: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: 16, marginBottom: 8 },
  card: { flex: 1, padding: 12, marginRight: 8, borderRadius: 8 },
  cardTitle: { fontSize: 12 },
  cardValue: { fontSize: 18, fontWeight: "700", marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "700", margin: 16 },
  buddyRow: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1 },
  buddyName: { fontWeight: "700", fontSize: 16 },
  buddyMeta: { color: "#9fb0d6" },
  buddyValue: { fontWeight: "700" },
  buddyROI: { color: "#1f6feb" },
  smallBtn: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "#122033", borderRadius: 6 },
  smallBtnText: { fontSize: 12, color: THEME.text },
  addButton: { padding: 12, borderRadius: 8, alignItems: "center", margin: 16 },
  addButtonText: { color: "#fff", fontWeight: "700" },
  modal: { padding: 16, paddingBottom: 40 },
  modalHeader: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 8 },
  modalButtons: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  paymentRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, alignItems: "center", paddingHorizontal: 8 },
  typeBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: "#122033" },
  typeBtnActive: { backgroundColor: THEME.accent },
  typeBtnText: { color: THEME.text },
  typeBtnTextActive: { color: "#fff" },
});
