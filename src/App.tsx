// ============================================================================
// BOARDING PASS — see src/version.ts for the current version
// App shell: game state, the two clocks (economy + real-UTC map), autosave &
// offline catch-up, data loading and top-level actions.
// Game logic lives in src/game/*, UI pieces in src/components/*.
// ============================================================================
// Must come first: carries careers over from the game's old name before anything reads them
import './game/storageMigration';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AircraftScheduleModal } from './components/AircraftScheduleModal';
import { AirportDrawer, type RouteDraft } from './components/AirportDrawer';
import { AlertModal, AwayReportModal, Toast } from './components/AlertModal';
import { UpdateBanner } from './components/UpdateBanner';
import { AirportsPanel } from './components/AirportsPanel';
import { BankPanel, MilestoneCard } from './components/BankPanel';
import { BankruptcyModal } from './components/BankruptcyModal';
import { BuyAircraftPanel } from './components/BuyAircraftPanel';
import { LayersMenu, NavRail, PANEL_GROUPS, TopBar, groupOfPanel, type MapStyleChoice, type PanelId } from './components/DashboardChrome';
import { AppearanceHost } from './components/Appearance';
import { FleetPanel } from './components/FleetPanel';
import { HomeScreen } from './components/HomeScreen';
import { LiveMap, type AiDensity, type AiDetail, type AiDrawStats } from './components/LiveMap';
import { SchedulePanel } from './components/SchedulePanel';
import { StatsPanel } from './components/StatsPanel';
import { AIRCRAFT_BY_ID, BUILTIN_AIRCRAFT } from './game/aircraftCatalog';
import { AI_AIRLINES, findMatchingAiAirline } from './game/aiAirlines';
import { generateAiTraffic, generateNetworkTraffic, type AiTraffic } from './game/aiTraffic';
import { airlineAirportPositions, applyNetworkWeights, parseNetwork, setNetwork, type NetworkData } from './game/demand';
import { BUILTIN_AIRPORTS } from './game/builtinData';
import {
  ECONOMY_RATE,
  advanceEconomy,
  catchUpGameMinutes,
  computeEconomyRates,
  econDayOf,
  econMinFromLegacy,
  econMinOfDay,
  econWeekOf,
  bookFlow,
  ledgerCashFlow,
  ledgerNet,
  weeklyCashFlowRate,
  econMapClock,
  utcClockAt,
  type MapSpeed,
  type CashFlowKind,
  type CatchUpReport,
  type EconomySpeed,
  type WeekLedger,
} from './game/clock';
import { parseOurAirportsCsvFiles, parseOurAirportsNavaidsCsv } from './game/csv';
import { buildCabinPreset, computeNetworkEconomics, getDefaultCabinForModel, getRouteDemandAndFares, calculateCabinUsage, type CabinPreset } from './game/economics';
import { checkReplacement, type BulkScheduleResult } from './game/fleetOps';
import { DEFAULT_LEASE_WEEKS, buyoutPrice, leaseQuote, returnTerms } from './game/leasing';
import { reRegisterSequence, registrationsForNewAircraft, validRegistration } from './game/registrations';
import {
  BANK,
  MIN_PART_REPAYMENT,
  borrowBlocker,
  computeCareerMetrics,
  debtSummary,
  drawLoan,
  freshCareer,
  hydrateCareer,
  partRepaymentPreview,
  productById,
  repayLoanEarly,
  repayLoanPart,
  reviewProgramme,
  settleBankruptcy,
  settleCareerAdvance,
  type BankruptcyRoute,
  uncollected,
  bailoutSeizures,
  usdShort,
  welcomeLetter,
} from './game/career';
import { calcDistanceNm } from './game/geo';
import {
  RADAR_GROUPS,
  drawRadarSilhouetteOnCanvas,
  getRadarIconGroup,
  iconKey,
  loadCustomPlaneIcons,
  maplibreHasGlobe,
  type PlaneIcon,
} from './game/icons';
import { clearFlightGeometryCache, runwayLanes, setGlobalNavaidsMemory } from './game/navdata';
import {
  downloadSaveFile,
  hydrateSave,
  readSaveSlots,
  readSaveFileText,
  upsertSaveSlot,
  writeSaveSlots,
} from './game/saves';
import { findScheduleConflict, flightsCancelledBySellingHub, flightsForTail, getAircraftCircuitStatus, nextFreeTailNumber, type PlanResult } from './game/scheduling';
import { calcAircraftResaleUsd, calcHubPurchasePriceUsd, calcHubSaleRefundUsd } from './game/tiers';
import { ALL_DAYS, daysOrAll, formatMoneyM, shiftDays } from './game/time';
import type {
  AircraftModel,
  Airport,
  CabinConfig,
  CareerState,
  GameAlert,
  GameMode,
  PlayerAircraft,
  RadarIconGroup,
  SaveGameState,
  ScheduledFlight,
} from './game/types';
import { APP_VERSION } from './version';
import { MainMenu } from './components/MainMenu';
import { CloudHost, openCloud } from './components/CloudPanel';
import { cloudDeleteSave, nextRev } from './game/cloud';
import { RouteFromBar } from './components/RouteFromBar';
import { WelcomeTour, tourWantedForNewCareer } from './components/WelcomeTour';
import { C, PanelTabsContext, applyThemeToDocument, useThemeVersion } from './ui/kit';
import { initLayout } from './ui/layout';

const STANDARD_START_CASH = 150_000_000;
const SANDBOX_START_CASH = 9_999_999_999;
const START_MIN = 480; // default departure time in the route builder (08:00 UTC)
const DEFAULT_MODEL = AIRCRAFT_BY_ID.get('a320neo') ?? BUILTIN_AIRCRAFT[0];
const ECONOMY_TICK_MS = 500;
const AUTOSAVE_MS = 60_000;
const LEDGER_HISTORY_WEEKS = 12;
const freshLedger = (week = 1): WeekLedger => ({ week, flightProfit: 0, leaseCost: 0 });
const PREFS_KEY = 'bp_pc_prefs_v1';
const AI_DENSITIES: AiDensity[] = ['off', 'low', 'medium', 'high'];
/** Extreme: 1.6× the flights on every route, so 10,000+ are in the air at any hour. */
const EXTREME_TRAFFIC_SCALE = 1.6;
/** Most aircraft bought or leased in one go. */
const MAX_BULK_BUY = 50;

function readPrefs(): {
  aiDensity?: AiDensity;
  mapSpeed?: MapSpeed;
  aiDetail?: AiDetail;
  hideMilestoneCard?: boolean;
  mapStyle?: MapStyleChoice;
  globe?: boolean;
  threeD?: boolean;
  /** 3D: detailed aircraft shapes (on unless turned off). */
  detailed3d?: boolean;
  showWeather?: boolean;
  showApproaches?: boolean;
  showNavaids?: boolean;
} {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function writePrefs(patch: Record<string, unknown>) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* storage unavailable */
  }
}

const makeDraft = (originIata: string, _airlineIata?: string): RouteDraft => ({
  originIata,
  tailNumber: '',
  // Empty: the planner suggests a number for the route's length
  flightNumber: '',
  depMin: START_MIN,
  days: [...ALL_DAYS],
  mode: 'roundtrip',
  fares: { econ: 120, prem: 210, bus: 450, first: 890, cargoPerTon: 380 },
});

function useGlobalReset() {
  useEffect(() => {
    applyThemeToDocument();
  }, []);
}

// Phone / tablet / desktop attributes on <html>, before anything renders
initLayout();

/**
 * A new airline set up on the website ("Print your boarding pass"): its name,
 * code, callsign and hub arrive in the address and fill in the home screen.
 * (Its colours arrive the same way and are applied by the theme code.)
 */
const LAUNCH = (() => {
  const out: { name?: string; code?: string; callsign?: string; hub?: string } = {};
  try {
    const q = new URLSearchParams(location.search);
    const clean = (v: string | null, re: RegExp, max: number) => (v && re.test(v.trim()) ? v.trim().slice(0, max) : undefined);
    out.name = clean(q.get('airline'), /^[\p{L}\p{N} .,'&-]{2,40}$/u, 40);
    out.code = clean(q.get('code')?.toUpperCase() ?? null, /^[A-Z0-9]{2,3}$/, 3);
    out.callsign = clean(q.get('callsign')?.toUpperCase() ?? null, /^[A-Z0-9 ]{2,20}$/, 20);
    out.hub = clean(q.get('hub')?.toUpperCase() ?? null, /^[A-Z]{3}$/, 3);
    if (Object.values(out).some(Boolean)) {
      const u = new URL(location.href);
      ['airline', 'code', 'callsign', 'hub'].forEach((k) => u.searchParams.delete(k));
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
  } catch {
    /* no address parameters */
  }
  return out;
})();

export default function App() {
  useGlobalReset();
  // A theme change re-renders everything with the new colours (ui/theme.ts)
  useThemeVersion();

  // ---------------------------------------------------------------------------
  // Core game state
  // ---------------------------------------------------------------------------
  const [screen, setScreen] = useState<'home' | 'dashboard'>('home');
  // The map is always on screen; everything else opens as a panel over it.
  const [panel, setPanel] = useState<PanelId | null>(null);
  // Last tab used in each toolbar group (My Airline, Buy)
  const [groupTab, setGroupTab] = useState<{ airline: PanelId; buy: PanelId }>({ airline: 'stats', buy: 'buy' });
  useEffect(() => {
    const g = groupOfPanel(panel);
    if (g && panel) setGroupTab((t) => (t[g] === panel ? t : { ...t, [g]: panel }));
  }, [panel]);
  const openGroup = (g: 'airline' | 'buy') => setPanel(groupTab[g]);

  const [airlineName, setAirlineName] = useState(LAUNCH.name ?? 'Jetstream Airlines');
  const [airlineIata, setAirlineIata] = useState(LAUNCH.code ?? 'JT');
  const [airlineCallsign, setAirlineCallsign] = useState(LAUNCH.callsign ?? (LAUNCH.name ? LAUNCH.name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'JETSTREAM' : 'JETSTREAM'));
  const [hubIata, setHubIata] = useState(LAUNCH.hub ?? 'BOS');
  const [hubs, setHubs] = useState<string[]>(['BOS']);
  const [gameMode, setGameMode] = useState<GameMode>('standard');
  const [cash, setCash] = useState(STANDARD_START_CASH);
  const cashRef = useRef(cash);
  cashRef.current = cash;
  const gameModeRef = useRef(gameMode);
  gameModeRef.current = gameMode;

  // Economy clock: total game minutes + the ledger of the week in progress
  const [econ, setEconState] = useState({ min: 0, current: freshLedger() });
  const econRef = useRef(econ);
  const econStampRef = useRef(Date.now()); // real time when econRef was last advanced
  const setEcon = useCallback((next: { min: number; current: WeekLedger }) => {
    econRef.current = next;
    econStampRef.current = Date.now();
    setEconState(next);
  }, []);
  const [ledgerHistory, setLedgerHistory] = useState<WeekLedger[]>([]);
  // Bank, loans and the milestone programme (Career mode)
  const [career, setCareerState] = useState<CareerState>(freshCareer);
  const careerRef = useRef(career);
  const setCareer = useCallback((next: CareerState) => {
    careerRef.current = next;
    setCareerState(next);
  }, []);
  const [bankTab, setBankTab] = useState<'programme' | 'loans' | 'letters'>('programme');
  const [hideMilestoneCard, setHideMilestoneCard] = useState(() => Boolean(readPrefs().hideMilestoneCard));
  const [econSpeed, setEconSpeed] = useState<EconomySpeed>('normal');
  const [awayReport, setAwayReport] = useState<CatchUpReport | null>(null);
  // Settlement screen: opens by itself when the airline becomes insolvent
  const [showSettlement, setShowSettlement] = useState(true);

  // Map clock: real UTC (1×) or the economy clock (7×). The map reads it every
  // frame through getMapClock; React state refreshes once a second for the UI.
  const [mapSpeed, setMapSpeedState] = useState<MapSpeed>(() => (readPrefs().mapSpeed === 'x7' ? 'x7' : 'live'));
  const setMapSpeed = (m: MapSpeed) => {
    setMapSpeedState(m);
    writePrefs({ mapSpeed: m });
  };
  const mapSpeedRef = useRef(mapSpeed);
  mapSpeedRef.current = mapSpeed;
  const econSpeedRef = useRef<EconomySpeed>(econSpeed);
  if (econSpeedRef.current !== econSpeed) {
    econSpeedRef.current = econSpeed;
    econStampRef.current = Date.now(); // restart extrapolation from the last tick
  }
  const getMapClock = useCallback(() => {
    const now = Date.now();
    if (mapSpeedRef.current === 'live') return utcClockAt(now);
    // Between economy ticks, extrapolate so planes glide instead of stepping
    const rate = ECONOMY_RATE[econSpeedRef.current];
    const elapsedSec = Math.min(2, Math.max(0, (now - econStampRef.current) / 1000));
    return econMapClock(econRef.current.min + elapsedSec * rate, now);
  }, []);
  const [mapNowMs, setMapNowMs] = useState(() => Date.now());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapClock = useMemo(() => getMapClock(), [mapNowMs, mapSpeed, getMapClock]);

  const [airports, setAirports] = useState<Airport[]>(BUILTIN_AIRPORTS);
  const [navaidsCount, setNavaidsCount] = useState(31);
  const [navaidsVersion, setNavaidsVersion] = useState(0);
  const [dataStatus, setDataStatus] = useState('Loading airport data…');
  const [fleet, setFleet] = useState<PlayerAircraft[]>([]);
  const [schedule, setSchedule] = useState<ScheduledFlight[]>([]);

  // Map toggles
  // Map look and overlays (remembered between sessions)
  const [mapStyle, setMapStyleState] = useState<MapStyleChoice>(() => {
    const m = readPrefs().mapStyle;
    return m === 'light' || m === 'satellite' ? m : 'dark';
  });
  const setMapStyle = (m: MapStyleChoice) => {
    setMapStyleState(m);
    writePrefs({ mapStyle: m });
  };
  const [globe, setGlobeState] = useState(() => readPrefs().globe === true);
  const setGlobe = (g: boolean) => {
    setGlobeState(g);
    writePrefs({ globe: g });
  };
  const [threeD, setThreeDState] = useState(() => readPrefs().threeD === true);
  const setThreeD = (v: boolean) => {
    setThreeDState(v);
    writePrefs({ threeD: v });
  };
  const [detailed3d, setDetailed3dState] = useState(() => readPrefs().detailed3d !== false);
  const setDetailed3d = (v: boolean) => {
    setDetailed3dState(v);
    writePrefs({ detailed3d: v });
  };
  const [showWeatherRadar, setShowWeatherState] = useState(() => readPrefs().showWeather === true);
  const setShowWeatherRadar = (v: boolean) => {
    setShowWeatherState(v);
    writePrefs({ showWeather: v });
  };
  const [showApproaches, setShowApproachesState] = useState(() => readPrefs().showApproaches === true);
  const setShowApproaches = (v: boolean) => {
    setShowApproachesState(v);
    writePrefs({ showApproaches: v });
  };
  const [showNavaids, setShowNavaidsState] = useState(() => readPrefs().showNavaids === true);
  const setShowNavaids = (v: boolean) => {
    setShowNavaidsState(v);
    writePrefs({ showNavaids: v });
  };
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [planeIconScale, setPlaneIconScale] = useState(0.85);
  const [customIcons, setCustomIcons] = useState<Record<string, PlaneIcon>>({});
  // Cosmetic AI traffic (OpenFlights)
  const [aiTraffic, setAiTraffic] = useState<AiTraffic | null>(null);
  // Extreme: a denser schedule on the same routes (built when first chosen)
  // What other airlines' traffic is built from: the real network, or the old OpenFlights files
  const aiSourceRef = useRef<{ network: NetworkData } | { airportsText: string; routesText: string; planesText?: string } | null>(null);
  // Airports with runways: busy airports spread other airlines' flights over their runways, and single-runway
  // airports sequence takeoffs and landings together
  const runwayAirportsRef = useRef<Map<string, Airport> | null>(null);
  const buildAiTraffic = (frequencyScale?: number) => {
    const src = aiSourceRef.current!;
    const aps = runwayAirportsRef.current;
    const runwayLanesOf = aps ? (iata: string) => { const a = aps.get(iata); return a ? runwayLanes(a) : { dep: 1, arr: 1, shared: false }; } : undefined;
    return 'network' in src ? generateNetworkTraffic({ network: src.network, frequencyScale, runwayLanes: runwayLanesOf }) : generateAiTraffic({ ...src, frequencyScale });
  };
  const [aiTrafficExtreme, setAiTrafficExtreme] = useState<AiTraffic | null>(null);
  const [aiStatus, setAiStatus] = useState('Loading other airline traffic…');
  const [aiDensity, setAiDensityState] = useState<AiDensity>(() => {
    const d = readPrefs().aiDensity;
    return d && AI_DENSITIES.includes(d) ? d : 'medium';
  });
  const setAiDensity = (d: AiDensity) => {
    setAiDensityState(d);
    writePrefs({ aiDensity: d });
  };
  // Real airline the player's airline replaces on the map (null = both fly)
  const [replacedAi, setReplacedAi] = useState<string | null>(null);
  const [aiStats, setAiStats] = useState<AiDrawStats>({ airborne: 0, drawn: 0, budget: Infinity });
  const [aiDetail, setAiDetailState] = useState<AiDetail>(() => {
    const d = readPrefs().aiDetail;
    return d && ['auto', 'low', 'medium', 'high', 'max', 'extreme'].includes(d) ? d : 'auto';
  });
  const setAiDetail = (d: AiDetail) => {
    setAiDetailState(d);
    writePrefs({ aiDetail: d });
    // Extreme means every flight: other airlines' traffic goes to All
    if (d === 'extreme' && aiDensity !== 'high') setAiDensity('high');
  };
  useEffect(() => {
    if (aiDetail !== 'extreme' || aiTrafficExtreme || !aiTraffic || !aiSourceRef.current) return;
    // Next tick, so the menu shows the choice before the (sub-second) build
    const id = window.setTimeout(() => {
      try {
        setAiTrafficExtreme(buildAiTraffic(EXTREME_TRAFFIC_SCALE));
      } catch {
        /* keep the normal schedule */
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [aiDetail, aiTraffic, aiTrafficExtreme]);
  const shownAiTraffic = aiDetail === 'extreme' && aiTrafficExtreme ? aiTrafficExtreme : aiTraffic;
  const mapRef = useRef<any>(null);

  // Saves
  const [activeSaveId, setActiveSaveId] = useState(`SAVE-${Date.now()}`);
  const [savedGames, setSavedGames] = useState<SaveGameState[]>([]);

  // Dealership
  const [selectedModel, setSelectedModel] = useState<AircraftModel>(DEFAULT_MODEL);
  const [cabinDraft, setCabinDraft] = useState<CabinConfig>(() => getDefaultCabinForModel(DEFAULT_MODEL));
  const [tailInput, setTailInput] = useState('N101JT');

  // Route builder & dialogs
  const [inspectedAirport, setInspectedAirport] = useState<Airport | null>(null);
  // Escape closes the planner (unless a dialog over it takes the key first)
  useEffect(() => {
    if (!inspectedAirport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.bp-modal-backdrop, .bp-tour, [aria-modal=true], [role=dialog]')) return;
      setInspectedAirport(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectedAirport]);
  // Route planning takes two taps: the airport you fly from, then where to.
  // The planner opens only once both are picked.
  const [routeFrom, setRouteFrom] = useState<Airport | null>(null);
  useEffect(() => {
    if (panel) setRouteFrom(null);
  }, [panel]);
  useEffect(() => {
    if (!routeFrom) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setRouteFrom(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [routeFrom]);
  const [draft, setDraft] = useState<RouteDraft>(() => makeDraft('BOS', 'JT'));
  const updateDraft = useCallback((patch: Partial<RouteDraft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const [scheduleModal, setScheduleModal] = useState<{ tail: string; flightId: string | null } | null>(null);
  const [gameAlert, setGameAlert] = useState<GameAlert | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  // Aircraft clicks are ignored while an airport is open; after a few misses, say why
  const blockedPlaneClicks = useRef(0);
  useEffect(() => {
    blockedPlaneClicks.current = 0;
  }, [inspectedAirport?.iata_code]);
  const onBlockedPlaneClick = () => {
    blockedPlaneClicks.current += 1;
    if (blockedPlaneClicks.current >= 6) {
      blockedPlaneClicks.current = 0;
      flashToast('Aircraft info is off while an airport is open. Close the airport panel to inspect planes.', 4500);
    }
  };

  const showAlert = (title: string, message: string, detail?: string, severity: GameAlert['severity'] = 'error') =>
    setGameAlert({ title, message, detail, severity });

  const flashToast = useCallback((message: string, ms = 3000) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const airportByIata = useMemo(() => new Map(airports.map((a) => [a.iata_code, a])), [airports]);
  const econById = useMemo(() => computeNetworkEconomics({ hubs, schedule, fleet }), [hubs, schedule, fleet]);
  const canAfford = (cost: number) => gameMode === 'sandbox' || cash >= cost;
  /**
   * Moves money in (+) or out (−) of the account and books it into this week's
   * cash flow (Career mode; Sandbox money is unlimited).
   */
  const bookCash = (kind: CashFlowKind, amount: number) => {
    if (gameModeRef.current === 'sandbox' || amount === 0) return;
    setCash((c) => c + amount);
    const cur = econRef.current;
    setEcon({ min: cur.min, current: bookFlow(cur.current, kind, amount) });
  };
  const spend = (cost: number) => bookCash('purchase', -cost);

  const builtinIconUrls = useMemo(() => {
    const out = {} as Record<RadarIconGroup, string>;
    RADAR_GROUPS.forEach((g) => (out[g] = drawRadarSilhouetteOnCanvas(g, C.fleet, 64).toDataURL()));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [C.fleet]);

  const iconForModel = useCallback(
    (m: AircraftModel): string => {
      const group = getRadarIconGroup(m);
      return (
        customIcons[iconKey.model(m)]?.dataUrl ??
        customIcons[iconKey.icao(m)]?.dataUrl ??
        customIcons[iconKey.group(group)]?.dataUrl ??
        builtinIconUrls[group]
      );
    },
    [customIcons, builtinIconUrls]
  );

  // ---------------------------------------------------------------------------
  // Startup: saves, OurAirports CSVs, custom plane icons
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setSavedGames(readSaveSlots());
    // The old airport cache filled localStorage and could make saves fail; drop it.
    try {
      localStorage.removeItem('bp_pc_custom_airports_v2');
    } catch {
      /* storage unavailable */
    }

    let cancelled = false;
    const fetchText = async (url: string) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const text = await res.text();
        // Dev servers answer missing files with index.html — make sure it's CSV
        return text.trimStart().startsWith('<') ? null : text;
      } catch {
        return null;
      }
    };

    (async () => {
      const [navText, apText, rwyText, netText] = await Promise.all([
        fetchText('/data/navaids.csv'),
        fetchText('/data/airports.csv'),
        fetchText('/data/runways.csv'),
        fetchText('/data/network.json'),
      ]);
      if (cancelled) return;
      const notes: string[] = [];

      // The real airline network: route demand, more airports, other airlines' flights
      let network: NetworkData | null = null;
      if (netText) {
        try {
          network = parseNetwork(JSON.parse(netText));
          setNetwork(network);
        } catch {
          network = null;
        }
      }

      if (navText) {
        const parsed = parseOurAirportsNavaidsCsv(navText);
        if (parsed.length > 100) {
          setGlobalNavaidsMemory(parsed);
          setNavaidsCount(parsed.length);
          setNavaidsVersion((v) => v + 1);
          notes.push(`${parsed.length.toLocaleString()} navaids`);
        }
      }
      if (apText) {
        let parsed = parseOurAirportsCsvFiles(apText, rwyText ?? undefined, network ? airlineAirportPositions(network) : undefined);
        if (network) parsed = applyNetworkWeights(parsed, network);
        if (parsed.length > 500) {
          clearFlightGeometryCache();
          setAirports(parsed);
          runwayAirportsRef.current = new Map(parsed.map((a) => [a.iata_code, a]));
          notes.push(`${parsed.length.toLocaleString()} airports${rwyText ? ' with runways' : ' (runways.csv missing)'}`);
        }
      }
      // Other airlines' traffic (cosmetic): the real network, or the old OpenFlights files
      const [ofAirports, ofRoutes, ofPlanes] = network
        ? [null, null, null]
        : await Promise.all([
            fetchText('/data/openflights/airports.dat'),
            fetchText('/data/openflights/routes.dat'),
            fetchText('/data/openflights/planes.dat'),
          ]);
      // Let the airports show first: the schedule takes about a second to build
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) return;
      if (network || (ofAirports && ofRoutes)) {
        try {
          aiSourceRef.current = network ? { network } : { airportsText: ofAirports!, routesText: ofRoutes!, planesText: ofPlanes ?? undefined };
          const traffic = buildAiTraffic();
          setAiTraffic(traffic);
          setAiStatus(
            `Other airlines: ${traffic.airlines.length} carriers, ${traffic.stats.routes.toLocaleString()} routes, about ${traffic.stats.avgPerDay.toLocaleString()} flights a day`
          );
        } catch (err) {
          setAiStatus(`Other airline traffic could not be built: ${(err as Error).message}`);
        }
      } else {
        setAiStatus('Other airline traffic is off. Add network.json to public/data/ (made by tools/build-network.mjs).');
      }

      setDataStatus(
        notes.length > 0
          ? `Loaded ${notes.join(', ')} from OurAirports${network ? `, and today\u2019s airline routes (${network.routes.length.toLocaleString()} routes, ${network.built})` : ''}.`
          : 'Using the small built-in airport list. Add airports.csv, runways.csv and navaids.csv to public/data/ for the full world.'
      );
    })();

    const stopIcons = loadCustomPlaneIcons((key, icon) => setCustomIcons((prev) => ({ ...prev, [key]: icon })));
    return () => {
      cancelled = true;
      stopIcons();
    };
  }, []);

  // When the full airport list arrives, re-link flights & the drawer to the new objects
  useEffect(() => {
    setSchedule((prev) =>
      prev.map((fl) => ({
        ...fl,
        origin: airportByIata.get(fl.origin.iata_code) ?? fl.origin,
        destination: airportByIata.get(fl.destination.iata_code) ?? fl.destination,
      }))
    );
    setInspectedAirport((prev) => (prev ? airportByIata.get(prev.iata_code) ?? prev : prev));
  }, [airportByIata]);

  // ---------------------------------------------------------------------------
  // Route-builder housekeeping
  // ---------------------------------------------------------------------------
  // Keep a valid aircraft selected
  useEffect(() => {
    if (fleet.length === 0) {
      if (draft.tailNumber) updateDraft({ tailNumber: '' });
    } else if (!fleet.some((f) => f.tailNumber === draft.tailNumber)) {
      updateDraft({ tailNumber: fleet[0].tailNumber });
    }
  }, [fleet, draft.tailNumber, updateDraft]);

  // You picked an aircraft in the route planner: continue from wherever it ends
  // its day. (Only an explicit pick moves the departure airport. The planner's
  // own aircraft suggestions, a new purchase or loading a save never do, so the
  // airport you chose to fly from stays put when you open another destination.)
  const pickAircraft = useCallback(
    (tail: string) => {
      const ac = fleet.find((f) => f.tailNumber === tail);
      if (!ac) return;
      const circuit = getAircraftCircuitStatus(ac, schedule);
      updateDraft(
        circuit.lastFlight
          ? {
              tailNumber: tail,
              originIata: circuit.currentEndIata,
              depMin: circuit.nextReadyDepMin,
              days: shiftDays(daysOrAll(circuit.lastFlight.daysOfWeek), circuit.nextReadyDayShift),
            }
          : { tailNumber: tail }
      );
    },
    [fleet, schedule, updateDraft]
  );

  // Default fares to the reference fares whenever the route changes
  useEffect(() => {
    const orig = airportByIata.get(draft.originIata);
    if (!orig || !inspectedAirport || orig.iata_code === inspectedAirport.iata_code) return;
    const { refFares } = getRouteDemandAndFares(orig, inspectedAirport, calcDistanceNm(orig, inspectedAirport));
    updateDraft({ fares: refFares });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.originIata, inspectedAirport?.iata_code]);

  // ---------------------------------------------------------------------------
  // Economy clock
  //   Money is no longer booked per departure. Each flight earns its profit ×
  //   weekly frequency spread evenly over the game week, and leases are paid
  //   per game day. Real elapsed time (Date.now) drives it, so a throttled or
  //   minimised window still earns the right amount.
  // ---------------------------------------------------------------------------
  const airlineNameRef = useRef(airlineName);
  airlineNameRef.current = airlineName;
  const econRates = useMemo(() => computeEconomyRates(schedule, econById, fleet), [schedule, econById, fleet]);
  const ratesRef = useRef(econRates);
  ratesRef.current = econRates;

  const applyAdvance = useCallback(
    (deltaGameMin: number) => {
      const res = advanceEconomy(econRef.current.min, econRef.current.current, deltaGameMin, ratesRef.current, careerRef.current.loans, cashRef.current);
      setEcon({ min: res.econMin, current: res.current });
      if (res.cashDelta !== 0) setCash((c) => c + res.cashDelta);
      if (res.closedWeeks.length > 0) {
        setLedgerHistory((prev) => [...prev, ...res.closedWeeks].slice(-LEDGER_HISTORY_WEEKS));
      }
      const nextCareer = settleCareerAdvance(careerRef.current, res, cashRef.current + res.cashDelta, airlineNameRef.current, { standard: gameModeRef.current === 'standard' });
      if (nextCareer !== careerRef.current) setCareer(nextCareer);
      return res;
    },
    [setEcon, setCareer]
  );

  useEffect(() => {
    if (screen !== 'dashboard') return;
    const id = window.setInterval(() => setMapNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [screen]);

  useEffect(() => {
    if (screen !== 'dashboard' || econSpeed === 'paused') return;
    const rate = ECONOMY_RATE[econSpeed];
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const realSec = (now - last) / 1000;
      last = now;
      const res = applyAdvance(realSec * rate);
      const closed = res.closedWeeks[res.closedWeeks.length - 1];
      if (closed) {
        const usd = (v: number) => (Math.round(v) === 0 ? '$0' : `${v > 0 ? '+' : '−'}$${Math.abs(Math.round(v)).toLocaleString()}`);
        const od = (closed.cashEnd ?? 0) < 0 && gameModeRef.current === 'standard' ? ' Your account is overdrawn: see the Bank.' : '';
        flashToast(`Week ${closed.week} closed. Profit ${usd(ledgerNet(closed))}, cash flow ${usd(ledgerCashFlow(closed))}.${od}`, 6000);
      }
    }, ECONOMY_TICK_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, econSpeed, applyAdvance]);

  // Hidden testing speed: Ctrl+Shift+F toggles 1 week per 10 minutes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setEconSpeed((s) => (s === 'test' ? 'normal' : 'test'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------------------
  // Career lifecycle
  // ---------------------------------------------------------------------------
  const currentSaveState = (isAutosave = false): SaveGameState => ({
    saveId: activeSaveId,
    airlineName,
    airlineIata,
    airlineCallsign,
    hubIata,
    hubs,
    gameMode,
    cash,
    simMin: econMinOfDay(econRef.current.min),
    simDay: econDayOf(econRef.current.min),
    fleet,
    schedule,
    savedAt: new Date().toLocaleString(),
    appVersion: APP_VERSION,
    econMin: econRef.current.min,
    lastRealTs: Date.now(),
    econPaused: econSpeed === 'paused',
    ledgerCurrent: econRef.current.current,
    ledgerHistory,
    isAutosave,
    career,
    replacesAiAirline: replacedAi,
  });

  /** Writes the current career into its slot. Returns false if storage failed. */
  const persistCareer = (isAutosave: boolean): boolean => {
    const slots = readSaveSlots();
    const prev = slots.find((s) => s.saveId === activeSaveId);
    const next = upsertSaveSlot(slots, { ...currentSaveState(isAutosave), rev: nextRev(prev) });
    if (!writeSaveSlots(next)) return false;
    setSavedGames(next);
    return true;
  };

  // Autosave every minute, when the window is hidden, and when it closes — so
  // the economy can catch up correctly next time the career is opened.
  const persistRef = useRef(persistCareer);
  persistRef.current = persistCareer;

  // Save straight after a career opens (once its state has rendered), so the
  // catch-up just applied can never be counted twice.
  const persistAfterRender = useRef(false);
  useEffect(() => {
    if (persistAfterRender.current && screen === 'dashboard') {
      persistAfterRender.current = false;
      persistRef.current(true);
    }
  });
  useEffect(() => {
    if (screen !== 'dashboard') return;
    const save = () => persistRef.current(true);
    const id = window.setInterval(save, AUTOSAVE_MS);
    const onHide = () => document.visibilityState === 'hidden' && save();
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [screen]);

  const resetTransientUi = () => {
    setRouteFrom(null);
    setInspectedAirport(null);
    setScheduleModal(null);
    setPanel(null);
  };

  /** Start button: if the airline copies a real one in the traffic list, ask first. */
  const requestLaunch = () => {
    const match = findMatchingAiAirline(airlineName, airlineIata, airlineCallsign, aiTraffic?.airlines ?? AI_AIRLINES);
    if (!match) {
      launchNewCareer(null);
      return;
    }
    const a = match.airline;
    const what = match.by.map((b) => (b === 'name' ? 'name' : b === 'code' ? `code ${a.code}` : `callsign ${a.callsign}`));
    const reason = what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0];
    setGameAlert({
      title: `${a.name} already flies on the map`,
      message: `Your airline has the same ${reason} as ${a.name}, one of the real airlines shown as other traffic. Should your airline take its place?`,
      detail: `Take its place: the real ${a.name} flights are left off the map, so the only ${a.name} aircraft you see are yours. Keep both: they keep flying alongside you.`,
      severity: 'info',
      confirmLabel: 'Take its place',
      onConfirm: () => launchNewCareer(a.code),
      secondaryLabel: 'Keep both',
      secondaryCloses: true,
      secondaryVariant: 'subtle',
      onSecondary: () => launchNewCareer(null),
    });
  };

  // Main menu and the welcome tour (shown when a new career starts)
  const [menuOpen, setMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const launchNewCareer = (replaces: string | null) => {
    setReplacedAi(replaces);
    setTourOpen(tourWantedForNewCareer());
    if (replaces) {
      const a = (aiTraffic?.airlines ?? AI_AIRLINES).find((x) => x.code === replaces);
      if (a) flashToast(`${a.name} is off the map. Yours are the only ${a.name} aircraft flying.`, 5000);
    }
    setActiveSaveId(`SAVE-${Date.now()}`);
    setHubs([hubIata]);
    setCash(gameMode === 'sandbox' ? SANDBOX_START_CASH : STANDARD_START_CASH);
    setEcon({ min: 0, current: freshLedger() });
    setLedgerHistory([]);
    setEconSpeed('normal');
    setAwayReport(null);
    setFleet([]);
    setSchedule([]);
    setCareer(gameMode === 'sandbox' ? freshCareer() : { ...freshCareer(), letters: [welcomeLetter(airlineName, airlineIata, hubIata, 0)] });
    setBankTab('programme');
    setDraft(makeDraft(hubIata, airlineIata));
    setTailInput(nextFreeTailNumber([], airlineIata, airportByIata.get(hubIata)?.iso_country));
    resetTransientUi();
    setScreen('dashboard');
  };

  const loadCareer = (raw: SaveGameState) => {
    setTourOpen(false);
    const s = hydrateSave(raw, airportByIata);
    setActiveSaveId(s.saveId);
    setAirlineName(s.airlineName);
    setAirlineIata(s.airlineIata);
    setAirlineCallsign(s.airlineCallsign);
    setHubIata(s.hubIata);
    setHubs(s.hubs!);
    setGameMode(s.gameMode as GameMode);
    setFleet(s.fleet);
    setSchedule(s.schedule);
    setLedgerHistory(s.ledgerHistory ?? []);
    setEconSpeed(s.econPaused ? 'paused' : 'normal');

    // Economy catch-up for the time the career wasn't open (7×, capped at 4 weeks)
    const startMin = s.econMin ?? econMinFromLegacy(s.simDay, s.simMin);
    const startLedger = s.ledgerCurrent ?? freshLedger(econWeekOf(startMin));
    const awayMs = s.lastRealTs ? Date.now() - s.lastRealTs : 0;
    const { gameMinutes, capped } = s.econPaused ? { gameMinutes: 0, capped: false } : catchUpGameMinutes(awayMs);
    // Bank: saves from before v2.8 start the programme now, with a welcome letter
    setReplacedAi(s.replacesAiAirline ?? null);
    let savedCareer = hydrateCareer(s.career);
    if (!s.career && s.gameMode === 'standard') savedCareer = { ...savedCareer, letters: [welcomeLetter(s.airlineName, s.airlineIata, s.hubIata, startMin)] };
    if (gameMinutes > 0) {
      const rates = computeEconomyRates(s.schedule, computeNetworkEconomics({ hubs: s.hubs!, schedule: s.schedule, fleet: s.fleet }), s.fleet);
      const res = advanceEconomy(startMin, startLedger, gameMinutes, rates, savedCareer.loans, s.cash);
      setEcon({ min: res.econMin, current: res.current });
      setCash(s.cash + res.cashDelta);
      setLedgerHistory([...(s.ledgerHistory ?? []), ...res.closedWeeks].slice(-LEDGER_HISTORY_WEEKS));
      setCareer(settleCareerAdvance(savedCareer, res, s.cash + res.cashDelta, s.airlineName, { standard: s.gameMode === 'standard' }));
      setAwayReport(
        awayMs >= 60_000
          ? {
              realAwayMs: awayMs,
              gameMinutes,
              capped,
              flightProfit: res.flightProfit,
              leaseCost: res.leaseCost,
              loanCost: res.loanCost,
              net: res.cashDelta,
              weeksClosed: res.closedWeeks.length,
            }
          : null
      );
    } else {
      setEcon({ min: startMin, current: startLedger });
      setCash(s.cash);
      setCareer(savedCareer);
      setAwayReport(null);
    }
    setBankTab('programme');

    setDraft({ ...makeDraft(s.hubIata, s.airlineIata), flightNumber: '' });
    setTailInput(nextFreeTailNumber(s.fleet, s.airlineIata, airportByIata.get(s.hubIata)?.iso_country));
    resetTransientUi();
    persistAfterRender.current = true;
    setScreen('dashboard');
  };

  const saveCareer = () => {
    if (persistCareer(false)) {
      flashToast(`Saved ${airlineName}`);
    } else {
      showAlert('Could not save', 'Browser storage is full or unavailable.', 'Use Export save file in the menu to keep a copy of this career.');
    }
  };

  const deleteSave = (saveId: string) => {
    const target = savedGames.find((s) => s.saveId === saveId);
    if (!target) return;
    setGameAlert({
      title: `Delete ${target.airlineName}?`,
      message: 'This save is removed from this computer. Export it first if you want to keep a copy.',
      severity: 'error',
      confirmLabel: 'Delete save',
      onConfirm: () => {
        const next = readSaveSlots().filter((s) => s.saveId !== saveId);
        setSavedGames(next);
        writeSaveSlots(next);
        cloudDeleteSave(saveId).catch(() => {
          /* offline: the cloud copy expires on its own */
        });
      },
    });
  };

  const importSaveFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = readSaveFileText(String(reader.result));
      if (!r.ok) {
        showAlert('Could not open this save', r.message, undefined, 'warning');
        return;
      }
      loadCareer(r.save);
      if (r.unprotected)
        showAlert(
          'Opened in Sandbox mode',
          `${r.save.airlineName} comes from a save file without the game's protection (exported before v2.38, or edited), so it plays in Sandbox mode.`,
          'Saves made from now on are protected and keep their mode.',
          'info'
        );
    };
    reader.readAsText(file);
  };

  // ---------------------------------------------------------------------------
  // Hubs
  // ---------------------------------------------------------------------------
  const buyHub = (airport: Airport) => {
    if (hubs.includes(airport.iata_code)) return;
    const price = calcHubPurchasePriceUsd(airport);
    if (!canAfford(price)) {
      showAlert('Not enough cash', `A hub at ${airport.iata_code} (${airport.municipality}) costs ${formatMoneyM(price)}.`, `You have ${formatMoneyM(cash, 2)}.`);
      return;
    }
    spend(price);
    setHubs((prev) => [...prev, airport.iata_code]);
    updateDraft({ originIata: airport.iata_code });
    flashToast(`${airport.iata_code} is now one of your hubs`);
  };

  const sellHub = (airport: Airport) => {
    if (!hubs.includes(airport.iata_code)) return;
    if (hubs.length <= 1) {
      showAlert('This is your only hub', 'Your airline needs at least one hub.', 'Buy another hub before selling this one.', 'warning');
      return;
    }
    const refund = calcHubSaleRefundUsd(airport);
    const cancel = flightsCancelledBySellingHub(schedule, airport.iata_code);
    const remaining = hubs.filter((h) => h !== airport.iata_code);
    const newPrimary = hubIata === airport.iata_code ? remaining[0] : hubIata;
    setGameAlert({
      title: `Sell ${airport.iata_code} hub?`,
      message: `You get ${formatMoneyM(refund)} back (70% of the price). ${
        cancel.size ? `Your ${cancel.size} ${cancel.size === 1 ? 'flight' : 'flights'} to and from ${airport.iata_code} ${cancel.size === 1 ? 'is' : 'are'} cancelled. ` : ''
      }Aircraft based there move to ${newPrimary}.`,
      severity: 'warning',
      confirmLabel: 'Sell hub',
      onConfirm: () => {
        bookCash('sale', refund);
        setHubs(remaining);
        setHubIata(newPrimary);
        setDraft((d) => (d.originIata === airport.iata_code ? { ...d, originIata: newPrimary } : d));
        setFleet((prev) => prev.map((ac) => (ac.hubIata === airport.iata_code ? { ...ac, hubIata: newPrimary } : ac)));
        setSchedule((prev) => prev.filter((f) => !cancel.has(f.id)));
        flashToast(`Sold ${airport.iata_code} for ${formatMoneyM(refund)}${cancel.size ? `, ${cancel.size} flights cancelled` : ''}`);
      },
    });
  };

  // ---------------------------------------------------------------------------
  // Aircraft
  // ---------------------------------------------------------------------------
  const hubCountry = airportByIata.get(hubIata)?.iso_country ?? 'US';
  /** Registrations for new aircraft: they follow the first aircraft's sequence (v2.52). */
  const regFor = (taken: PlayerAircraft[], n = 1, typedFirst?: string) =>
    registrationsForNewAircraft(taken.map((a) => a.tailNumber), airlineIata, hubCountry, n, typedFirst);

  /** Buy or lease `count` aircraft of the selected type (leases for `leaseWeeks`). */
  const acquireAircraft = (mode: 'owned' | 'leased', leaseWeeks = DEFAULT_LEASE_WEEKS, count = 1) => {
    const check = calculateCabinUsage(selectedModel, cabinDraft);
    if (!check.isValid) {
      showAlert(
        'Cabin does not fit',
        'The layout needs at least one seat and must fit the cabin length and the exit limit.',
        `Uses ${check.usedMeters} of ${check.maxMeters} m, ${check.totalSeats} of ${check.maxExitLimit} seats.`
      );
      return;
    }
    const n = Math.max(1, Math.min(MAX_BULK_BUY, Math.round(count)));
    const now = econRef.current.min;
    const quote = leaseQuote(selectedModel, leaseWeeks, now);
    const each = mode === 'owned' ? selectedModel.base_price_usd : quote.deposit;
    const cost = each * n;
    if (!canAfford(cost)) {
      showAlert(
        'Not enough cash',
        `${n > 1 ? `${n} × the` : 'The'} ${selectedModel.name} ${mode === 'owned' ? 'cost' : 'deposit'}${n > 1 ? 's' : ''} ${formatMoneyM(cost, 2)} up front.`,
        `You have ${formatMoneyM(cash, 2)}.`
      );
      return;
    }
    // The typed registration starts the batch and the rest count on from it (N418JT, N419JT…);
    // without one they follow the airline's first aircraft
    let first = tailInput.trim().toUpperCase();
    if (!first || !validRegistration(first) || fleet.some((f) => f.tailNumber === first)) first = '';
    const regs = regFor(fleet, n, first || undefined);
    spend(cost);
    const added: PlayerAircraft[] = regs.map((tail) => ({
      tailNumber: tail,
      model: selectedModel,
      acquisition: mode,
      hubIata,
      cabin: { ...cabinDraft },
      acquiredMin: now,
      lease: mode === 'leased' ? { ...quote } : undefined,
    }));
    const nextFleet = [...fleet, ...added];
    setFleet(nextFleet);
    updateDraft({ tailNumber: regs[0] });
    setTailInput(regFor(nextFleet)[0]);
    flashToast(
      n === 1
        ? `${regs[0]} delivered to ${hubIata}. Open an airport on the map to schedule it.`
        : `${n} ${selectedModel.name} delivered to ${hubIata}: ${regs[0]} to ${regs[n - 1]}.`,
      4500
    );
  };

  /** Removes aircraft and their flights (after a sale, a return or a replacement). */
  const dropAircraft = (tails: Set<string>) => {
    setFleet((prev) => prev.filter((f) => !tails.has(f.tailNumber)));
    setSchedule((prev) => prev.filter((s) => !tails.has(s.tailNumber)));
    setScheduleModal((m) => (m && tails.has(m.tail) ? null : m));
  };

  /** What selling (owned) or returning (leased) these aircraft brings in. */
  const disposalTerms = (list: PlayerAircraft[]) => {
    const now = econRef.current.min;
    let sale = 0;
    let refund = 0;
    let forfeit = 0;
    for (const ac of list) {
      if (ac.acquisition === 'owned') sale += calcAircraftResaleUsd(ac.model);
      else {
        const t = returnTerms(ac, now);
        refund += t.refund;
        forfeit += t.forfeit;
      }
    }
    return { sale, refund, forfeit };
  };

  /** Sell owned and return leased aircraft (one or many). */
  const sellOrReturnAircraft = (tailsIn: string | string[]) => {
    const tails = new Set(Array.isArray(tailsIn) ? tailsIn : [tailsIn]);
    const list = fleet.filter((f) => tails.has(f.tailNumber));
    if (!list.length) return;
    const legs = schedule.filter((s) => tails.has(s.tailNumber)).length;
    const owned = list.filter((a) => a.acquisition === 'owned');
    const leased = list.filter((a) => a.acquisition === 'leased');
    const t = disposalTerms(list);
    const one = list.length === 1 ? list[0] : null;
    const early = leased.filter((a) => returnTerms(a, econRef.current.min).early);
    setGameAlert({
      title: one ? (one.acquisition === 'owned' ? `Sell ${one.tailNumber}?` : `Return ${one.tailNumber} to the lessor?`) : `Sell or return ${list.length} aircraft?`,
      message: [
        owned.length ? `${owned.length === 1 && one ? 'You get' : `${owned.length} sold for`} ${formatMoneyM(t.sale, 2)}${owned.length === 1 && one ? ` for this ${one.model.name}` : ''}.` : '',
        leased.length
          ? `${leased.length === 1 && one ? 'It goes back' : `${leased.length} leased go back`} to the lessor${t.refund ? `, with ${formatMoneyM(t.refund, 2)} of deposit refunded` : ''}${t.forfeit ? ` and ${formatMoneyM(t.forfeit, 2)} kept by the lessor for ending ${early.length === 1 ? 'the lease' : `${early.length} leases`} early` : ''}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      detail: legs > 0 ? `${legs} scheduled ${legs === 1 ? 'flight' : 'flights'} will be cancelled.` : undefined,
      severity: 'warning',
      confirmLabel: one ? (one.acquisition === 'owned' ? 'Sell aircraft' : 'Return aircraft') : `Sell or return ${list.length}`,
      onConfirm: () => {
        if (t.sale) bookCash('sale', t.sale);
        if (t.refund) bookCash('sale', t.refund);
        dropAircraft(tails);
        flashToast(one ? (one.acquisition === 'owned' ? `Sold ${one.tailNumber} for ${formatMoneyM(t.sale, 2)}` : `Returned ${one.tailNumber} to the lessor`) : `${list.length} aircraft sold or returned, ${formatMoneyM(t.sale + t.refund, 2)} in`);
      },
    });
  };

  /** Buy out a leased aircraft: it becomes yours and the deposit comes back. */
  const buyOutLease = (tail: string) => {
    const ac = fleet.find((f) => f.tailNumber === tail);
    if (!ac || ac.acquisition !== 'leased') return;
    const now = econRef.current.min;
    const price = buyoutPrice(ac, now);
    const deposit = ac.lease?.deposit ?? 0;
    if (!canAfford(price - deposit)) {
      showAlert('Not enough cash', `Buying out ${tail} costs ${formatMoneyM(price, 2)}, less the ${formatMoneyM(deposit, 2)} deposit you get back.`, `You have ${formatMoneyM(cash, 2)}.`);
      return;
    }
    setGameAlert({
      title: `Buy out ${tail}?`,
      message: `${tail} becomes yours for ${formatMoneyM(price, 2)}${deposit ? `, and the ${formatMoneyM(deposit, 2)} deposit is refunded` : ''}. No more lease payments.`,
      detail: `List price ${formatMoneyM(ac.model.base_price_usd, 2)}. Owned aircraft resell for 75% of it.`,
      severity: 'info',
      confirmLabel: `Buy out for ${formatMoneyM(price, 2)}`,
      onConfirm: () => {
        spend(price);
        if (deposit) bookCash('sale', deposit);
        setFleet((prev) => prev.map((f) => (f.tailNumber === tail ? { ...f, acquisition: 'owned', lease: undefined } : f)));
        flashToast(`${tail} is now yours`);
      },
    });
  };

  /** Change an aircraft's registration (its flights follow). */
  const renameAircraft = (tail: string, nextRaw: string): string | null => {
    const next = nextRaw.trim().toUpperCase();
    if (next === tail) return null;
    if (!validRegistration(next)) return 'Use 3 to 10 letters, digits and dashes, like G-JTAB or N401JT.';
    if (fleet.some((f) => f.tailNumber === next)) return `${next} is already in your fleet.`;
    setFleet((prev) => prev.map((f) => (f.tailNumber === tail ? { ...f, tailNumber: next } : f)));
    setSchedule((prev) => prev.map((s) => (s.tailNumber === tail ? { ...s, tailNumber: next } : s)));
    setScheduleModal((m) => (m?.tail === tail ? { ...m, tail: next } : m));
    if (draft.tailNumber === tail) updateDraft({ tailNumber: next });
    flashToast(`${tail} is now ${next}`);
    return null;
  };

  /**
   * Gives several aircraft new registrations counting on from `startRaw`, in
   * the order given (v2.52). Their flights follow. Returns an error message.
   */
  const reRegisterAircraft = (tails: string[], startRaw: string): string | null => {
    const start = startRaw.trim().toUpperCase();
    if (!validRegistration(start)) return 'Use 3 to 10 letters, digits and dashes, like G-JTAB or N401JT.';
    const ordered = fleet.map((f) => f.tailNumber).filter((t) => tails.includes(t));
    const regs = reRegisterSequence(start, ordered, fleet.map((f) => f.tailNumber));
    if (!regs) return `${start} has nothing to count on (it needs digits, or letters after a dash). Try one like N401JT or P4-AAA.`;
    const map = new Map(ordered.map((t, i) => [t, regs[i]]));
    const to = (t: string) => map.get(t) ?? t;
    setFleet((prev) => prev.map((f) => (map.has(f.tailNumber) ? { ...f, tailNumber: to(f.tailNumber) } : f)));
    setSchedule((prev) => prev.map((s) => (map.has(s.tailNumber) ? { ...s, tailNumber: to(s.tailNumber) } : s)));
    setScheduleModal((m) => (m && map.has(m.tail) ? { ...m, tail: to(m.tail) } : m));
    if (map.has(draft.tailNumber)) updateDraft({ tailNumber: to(draft.tailNumber) });
    flashToast(`${ordered.length} aircraft re-registered: ${regs[0]} to ${regs[regs.length - 1]}`);
    return null;
  };

  /** Fit the same cabin (or the same preset) to several aircraft. */
  const refitAircraft = (tails: string[], fit: { cabin: CabinConfig } | { preset: CabinPreset }) => {
    const set = new Set(tails);
    setFleet((prev) =>
      prev.map((ac) => {
        if (!set.has(ac.tailNumber) || ac.model.is_cargo) return ac;
        if ('cabin' in fit) return calculateCabinUsage(ac.model, fit.cabin).isValid ? { ...ac, cabin: { ...fit.cabin } } : ac;
        return { ...ac, cabin: buildCabinPreset(ac.model, fit.preset) };
      })
    );
    flashToast(tails.length === 1 ? `New cabin fitted to ${tails[0]}` : `New cabins fitted to ${tails.length} aircraft`);
  };

  /**
   * Replace aircraft with new ones of `model` (bought or leased). Each new
   * aircraft takes over the old one's flights that it can fly (re-timed for
   * its speed); the old one is sold or returned.
   */
  const replaceAircraft = (tails: string[], model: AircraftModel, mode: 'owned' | 'leased', leaseWeeks: number, dropClashing: boolean) => {
    const olds = fleet.filter((f) => tails.includes(f.tailNumber));
    if (!olds.length) return;
    const now = econRef.current.min;
    const quote = leaseQuote(model, leaseWeeks, now);
    const cost = (mode === 'owned' ? model.base_price_usd : quote.deposit) * olds.length;
    const t = disposalTerms(olds);
    if (!canAfford(cost - t.sale - t.refund)) {
      showAlert('Not enough cash', `Replacing ${olds.length} aircraft costs ${formatMoneyM(cost, 2)}, and the old ones bring in ${formatMoneyM(t.sale + t.refund, 2)}.`, `You have ${formatMoneyM(cash, 2)}.`);
      return;
    }
    const regs = regFor(fleet, olds.length);
    let keptFlights = 0;
    let lostFlights = 0;
    const done: { old: PlayerAircraft; ac: PlayerAircraft; flights: ScheduledFlight[] }[] = [];
    olds.forEach((old, i) => {
      const c = checkReplacement(old, model, schedule);
      if (c.clashes.length && !dropClashing) return;
      let flights = c.flights;
      if (c.clashes.length) {
        // Keep flights in time order while they still fit with the new type's timings
        const ok: ScheduledFlight[] = [];
        for (const fl of [...flights].sort((a, b) => a.depTimeMin - b.depTimeMin))
          if (!findScheduleConflict(ok, [{ flightNumber: fl.flightNumber, depTimeMin: fl.depTimeMin, blockTimeMin: fl.blockTimeMin, daysOfWeek: daysOrAll(fl.daysOfWeek) }], model.turnaround_min)) ok.push(fl);
        flights = ok;
      }
      keptFlights += flights.length;
      lostFlights += flightsForTail(schedule, old.tailNumber).length - flights.length;
      const ac: PlayerAircraft = {
        tailNumber: regs[i],
        model,
        acquisition: mode,
        hubIata: old.hubIata,
        cabin: model.is_cargo ? old.cabin : getDefaultCabinForModel(model),
        acquiredMin: now,
        lease: mode === 'leased' ? { ...quote } : undefined,
      };
      done.push({ old, ac, flights: flights.map((fl) => ({ ...fl, tailNumber: regs[i] })) });
    });
    if (!done.length) {
      showAlert('Nothing replaced', 'The new type can\u2019t fit any of these schedules as they are.', 'Tick "Drop flights that no longer fit" to replace them anyway.', 'warning');
      return;
    }
    const replaced = new Set(done.map((d) => d.old.tailNumber));
    const tr = disposalTerms(done.map((d) => d.old));
    spend((mode === 'owned' ? model.base_price_usd : quote.deposit) * done.length);
    if (tr.sale) bookCash('sale', tr.sale);
    if (tr.refund) bookCash('sale', tr.refund);
    setFleet((prev) => [...prev.filter((f) => !replaced.has(f.tailNumber)), ...done.map((d) => d.ac)]);
    setSchedule((prev) => [...prev.filter((s) => !replaced.has(s.tailNumber)), ...done.flatMap((d) => d.flights)]);
    setScheduleModal((m) => (m && replaced.has(m.tail) ? null : m));
    flashToast(
      `${done.length === 1 ? `${done[0].ac.tailNumber} replaced ${done[0].old.tailNumber}` : `${done.length} ${model.name} replaced the old aircraft`} and took over ${keptFlights} flights${lostFlights ? ` (${lostFlights} dropped)` : ''}.`,
      6000
    );
  };

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------
  const applyPlan = (result: PlanResult) => {
    if (!result.ok) {
      if (result.lockOriginIata) updateDraft({ originIata: result.lockOriginIata });
      setGameAlert(result.alert);
      return;
    }
    const nextSchedule = [...schedule, ...result.flights];
    setSchedule(nextSchedule);
    updateDraft({
      originIata: result.next.originIata,
      depMin: result.next.depMin,
      days: result.next.days,
      flightNumber: '',
    });
    flashToast(result.message);
  };

  const deleteFlightWithPair = (flightId: string) => {
    const target = schedule.find((s) => s.id === flightId);
    if (!target) return;
    setSchedule((prev) => prev.filter((s) => s.id !== flightId && !(target.pairId && s.pairId === target.pairId)));
  };

  const updateFlight = (updated: ScheduledFlight) => {
    setSchedule((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    flashToast(`Saved changes to ${updated.flightNumber}`);
  };

  // Several aircraft on one route (Fleet → select → Schedule together)
  const [bulkTails, setBulkTails] = useState<string[] | null>(null);
  const startBulkSchedule = (tails: string[]) => {
    if (tails.length === 0) return;
    setBulkTails(tails);
    setPanel(null);
    updateDraft({ tailNumber: tails[0] });
    flashToast(`Pick an airport on the map to schedule ${tails.length === 1 ? tails[0] : `these ${tails.length} aircraft`} there`, 5000);
  };
  const applyBulkPlan = (r: BulkScheduleResult) => {
    const ok = r.results.filter((x) => x.result.ok);
    const failed = r.results.filter((x) => !x.result.ok);
    if (ok.length) {
      setSchedule((prev) => [...prev, ...r.flights]);
      updateDraft({ flightNumber: '' });
    }
    if (failed.length) {
      setGameAlert({
        title: ok.length ? `${ok.length} scheduled, ${failed.length} couldn't be` : 'None of them could be scheduled',
        message: failed.map((f) => `${f.tail}: ${f.result.ok ? '' : f.result.alert.title}`).join('. ') + '.',
        detail: failed[0] && !failed[0].result.ok ? failed[0].result.alert.message : undefined,
        severity: ok.length ? 'warning' : 'error',
      });
    } else flashToast(`Scheduled ${ok.length} aircraft on the route, ${r.flights.length} flights`, 4500);
    if (ok.length && !failed.length) setBulkTails(null);
  };

  // ---------------------------------------------------------------------------
  // Bank
  // ---------------------------------------------------------------------------
  const careerMetrics = useMemo(
    () => computeCareerMetrics({ fleet, schedule, hubs, airportByIata, econById, career: careerRef.current }),
    // Only the two career fields the metrics read; loan balances change every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fleet, schedule, hubs, airportByIata, econById, career.bestWeekNet, career.loansRepaid]
  );

  // A letter for every milestone met and stage completed (Career mode only),
  // checked again every game hour (milestones after stage 1 wait out a game day)
  const econHour = Math.floor(econ.min / 60);
  useEffect(() => {
    if (screen !== 'dashboard' || gameMode !== 'standard') return;
    const r = reviewProgramme(careerRef.current, careerMetrics, { airlineName, econMin: econRef.current.min, fleet });
    if (!r) return;
    setCareer(r.career);
    if (r.letters.length === 0) return;
    const standing = r.letters.find((l) => l.kind === 'standing');
    flashToast(
      standing
        ? `${BANK.name}: ${standing.subject}`
        : r.letters.length === 1
        ? `${BANK.name}: ${r.letters[0].subject}. ${usdShort(r.letters[0].reward ?? 0)} grant ready to collect`
        : `${BANK.name}: ${r.letters.length} milestones met, grants ready to collect`,
      5000
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerMetrics, screen, gameMode, econHour]);

  const takeLoan = (productId: string, amount: number) => {
    const product = productById(productId);
    const blocker = borrowBlocker(careerRef.current, fleet, cash, amount, econRef.current.min);
    if (gameMode !== 'standard' || blocker) {
      if (blocker) showAlert('Loan not available', blocker, undefined, 'warning');
      return;
    }
    const { loan, career: next } = drawLoan(careerRef.current, product, amount, econRef.current.min, airlineName);
    setGameAlert({
      title: `Borrow ${usdShort(amount)} (${product.name})?`,
      message: `${product.termWeeks} weekly instalments of ${usdShort(loan.weeklyPayment)} at ${loan.ratePct}% a year, ${usdShort(loan.totalRepayable)} in total. Instalments are taken automatically and you can repay early at no charge.`,
      severity: 'info',
      confirmLabel: 'Sign agreement',
      onConfirm: () => {
        setCareer(next);
        bookCash('loan', loan.principal);
        flashToast(`${usdShort(loan.principal)} from ${BANK.name} paid into your account (${loan.ref})`, 4500);
      },
    });
  };

  const repayLoan = (loanId: string) => {
    const r = repayLoanEarly(careerRef.current, loanId, econRef.current.min, airlineName);
    if (!r) return;
    if (cash < r.amount) {
      showAlert('Not enough cash', `Settling this loan needs ${usdShort(r.amount)}.`, `You have ${usdShort(cash)}.`, 'warning');
      return;
    }
    setGameAlert({
      title: `Repay ${usdShort(r.amount)} now?`,
      message: 'This settles the loan in full. No further instalments will be taken and there is no early repayment charge.',
      severity: 'info',
      confirmLabel: 'Repay loan',
      onConfirm: () => {
        setCareer(r.career);
        bookCash('repay', -r.amount);
        flashToast(`Loan settled. ${usdShort(r.amount)} paid to ${BANK.name}`);
      },
    });
  };

  /** Pays part of a loan now (the rest stays on the same end date, with smaller instalments). */
  const repayLoanPartNow = (loanId: string, amount: number) => {
    const loan = careerRef.current.loans.find((l) => l.id === loanId);
    if (!loan || gameMode !== 'standard') return;
    const pv = partRepaymentPreview(loan, amount);
    if (pv.pay < MIN_PART_REPAYMENT && !pv.settles) {
      showAlert('Amount too small', `The smallest part repayment is ${usdShort(MIN_PART_REPAYMENT)}.`, undefined, 'warning');
      return;
    }
    if (cash < pv.pay) {
      showAlert('Not enough cash', `Paying ${usdShort(pv.pay)} needs that much in your account.`, `You have ${usdShort(cash)}.`, 'warning');
      return;
    }
    if (pv.settles) return repayLoan(loanId);
    const r = repayLoanPart(careerRef.current, loanId, pv.pay, econRef.current.min, airlineName);
    if (!r) return;
    setCareer(r.career);
    bookCash('repay', -r.amount);
    flashToast(`Paid ${usdShort(r.amount)} off ${loan.ref}. Instalments are now ${usdShort(pv.weeklyAfter)} a week, ${usdShort(pv.interestSaved)} less interest.`, 5000);
  };

  // Bankruptcy: what each aircraft earns a week, for the bank's proposal
  const weeklyProfitByTail = useMemo(() => {
    const m = new Map<string, number>();
    for (const fl of schedule) m.set(fl.tailNumber, (m.get(fl.tailNumber) ?? 0) + (econById.get(fl.id)?.profit ?? 0) * daysOrAll(fl.daysOfWeek).filter(Boolean).length);
    return m;
  }, [schedule, econById]);

  const debt = debtSummary(career, cash, econ.min);
  const topBarMoney = {
    rate: weeklyCashFlowRate(econRates, career.loans, gameMode === 'standard' ? cash : 0),
    debt: debt.total > 0.5 ? debt : null,
    insolvent: Boolean(career.insolvent),
    overdrawnWeeks: career.overdrawnWeeks ?? 0,
  };

  const scheduledTails = useMemo(() => new Set(schedule.map((f) => f.tailNumber)), [schedule]);
  // Each new insolvency opens the settlement screen
  const insolventAt = career.insolvent?.econMin;
  useEffect(() => {
    if (insolventAt !== undefined) setShowSettlement(true);
  }, [insolventAt]);

  /** Settles an insolvency: sell the chosen aircraft (10+ aircraft), or take the bail-out. */
  const settleInsolvency = (route: BankruptcyRoute, sellTails: string[] = []) => {
    const c = careerRef.current;
    if (!c.insolvent || gameMode !== 'standard') return;
    const before = cashRef.current;
    let proceeds = 0;
    // A bail-out takes the aircraft you own first (see bailoutSeizures)
    if (route === 'bailout') sellTails = bailoutSeizures(c, before, fleet, (a) => calcAircraftResaleUsd(a.model));
    if (sellTails.length) {
      const sold = new Set(sellTails);
      for (const ac of fleet) if (sold.has(ac.tailNumber) && ac.acquisition === 'owned') proceeds += calcAircraftResaleUsd(ac.model);
      setFleet((prev) => prev.filter((f) => !sold.has(f.tailNumber)));
      setSchedule((prev) => prev.filter((f) => !sold.has(f.tailNumber)));
      setScheduleModal((m) => (m && sold.has(m.tail) ? null : m));
    }
    const r = settleBankruptcy(c, before, route, econRef.current.min, airlineName, { proceeds, count: sellTails.length });
    setCareer(r.career);
    // Book the sale, then the settlement (debts paid from it, or written off), so cash flow adds up
    if (proceeds) bookCash('sale', proceeds);
    bookCash('bailout', r.cashAfter - before - proceeds);
    flashToast(
      route === 'bailout'
        ? `${BANK.name} has settled your debts${sellTails.length ? `, taking ${sellTails.length} of your aircraft` : ''}. No new loans for 48 hours.`
        : `${sellTails.length} aircraft sold for ${usdShort(proceeds)}. Your debts are cleared${r.terms.surplus ? ` and ${usdShort(r.terms.surplus)} is yours` : ''}.`,
      6000
    );
  };

  const collectLetter = (letterId: string) => {
    const c = careerRef.current;
    const letter = c.letters.find((l) => l.id === letterId);
    if (!letter?.reward || letter.collected || gameMode !== 'standard') return;
    setCareer({ ...c, letters: c.letters.map((l) => (l.id === letterId ? { ...l, collected: true, read: true } : l)) });
    bookCash('grant', letter.reward!);
    flashToast(`${usdShort(letter.reward)} paid into your account`);
  };

  const markLetterRead = useCallback(
    (letterId: string) => {
      const c = careerRef.current;
      if (!c.letters.some((l) => l.id === letterId && !l.read)) return;
      setCareer({ ...c, letters: c.letters.map((l) => (l.id === letterId ? { ...l, read: true } : l)) });
    },
    [setCareer]
  );

  const bankBadge = gameMode === 'standard' ? new Set([...uncollected(career), ...career.letters.filter((l) => !l.read)].map((l) => l.id)).size : 0;

  /** An airport tapped on the map. */
  const onMapAirport = (ap: Airport | null) => {
    if (!ap) {
      setRouteFrom(null);
      setInspectedAirport(null);
      return;
    }
    // Planner open: the tap picks a new destination (or the origin's own details)
    if (inspectedAirport) {
      setInspectedAirport(ap);
      return;
    }
    if (!routeFrom) {
      setRouteFrom(ap);
      setPanel(null);
      return;
    }
    // Second tap: same airport = its details; another = plan the route
    if (ap.iata_code !== routeFrom.iata_code) updateDraft({ originIata: routeFrom.iata_code });
    setRouteFrom(null);
    setInspectedAirport(ap);
  };

  const showAirportOnMap = (ap: Airport) => {
    setRouteFrom(null);
    setInspectedAirport(ap);
    setPanel(null);
    mapRef.current?.flyTo({ center: [ap.longitude_deg, ap.latitude_deg], zoom: 6.2 });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const overlays = (
    <>
      {gameAlert && <AlertModal alert={gameAlert} onDismiss={() => setGameAlert(null)} />}
      {toast && <Toast key={toast} message={toast} onDismiss={() => setToast(null)} />}
      <UpdateBanner onBeforeInstall={() => screen === 'dashboard' && persistRef.current(true)} />
      <AppearanceHost mapStyle={mapStyle} onMapStyle={setMapStyle} />
    </>
  );

  if (screen === 'home') {
    return (
      <>
        <CloudHost openSaveId={null} onSlotsChanged={() => setSavedGames(readSaveSlots())} toast={flashToast} />
        <HomeScreen
          onCloud={openCloud}
          onCloudDownloaded={() => setSavedGames(readSaveSlots())}
          toast={flashToast}
          airlineName={airlineName}
          airlineIata={airlineIata}
          airlineCallsign={airlineCallsign}
          hubIata={hubIata}
          gameMode={gameMode}
          onChange={(p) => {
            if (p.airlineName !== undefined) setAirlineName(p.airlineName);
            if (p.airlineIata !== undefined) setAirlineIata(p.airlineIata);
            if (p.airlineCallsign !== undefined) setAirlineCallsign(p.airlineCallsign);
            if (p.hubIata !== undefined) setHubIata(p.hubIata);
            if (p.gameMode !== undefined) setGameMode(p.gameMode);
          }}
          airports={airports}
          airportByIata={airportByIata}
          navaidsCount={navaidsCount}
          aircraftCount={BUILTIN_AIRCRAFT.length}
          dataStatus={`${dataStatus}\n${aiStatus}`}
          savedGames={savedGames}
          onLaunch={requestLaunch}
          onResume={loadCareer}
          onDeleteSave={deleteSave}
          onImportFile={importSaveFile}
        />
        {overlays}
      </>
    );
  }

  const hubAirport = airportByIata.get(hubIata) ?? BUILTIN_AIRPORTS[0];
  const modalAircraft = scheduleModal ? fleet.find((f) => f.tailNumber === scheduleModal.tail) ?? null : null;
  const openSchedule = (tail: string, flightId: string | null) => setScheduleModal({ tail, flightId });

  const closePanel = () => setPanel(null);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', background: C.bg, color: C.text, overflow: 'hidden' }}>
      <LiveMap
        visible
        initialCenter={[hubAirport.longitude_deg, hubAirport.latitude_deg]}
        airports={airports}
        airportByIata={airportByIata}
        hubs={hubs}
        schedule={schedule}
        fleet={fleet}
        econById={econById}
        mapDay={mapClock.day}
        mapMin={mapClock.min}
        airlineCallsign={airlineCallsign}
        inspectedAirport={inspectedAirport ?? routeFrom}
        hidePlanes={Boolean(inspectedAirport)}
        onInspectAirport={onMapAirport}
        previewOrigin={routeFrom ? null : airportByIata.get(draft.originIata) ?? null}
        showWeatherRadar={showWeatherRadar}
        showApproaches={showApproaches}
        showNavaids={showNavaids}
        mapStyle={mapStyle}
        globe={globe}
        threeD={threeD}
        detailed3d={detailed3d}
        showAllRoutes={showAllRoutes}
        planeIconScale={planeIconScale}
        aiTraffic={shownAiTraffic}
        aiDensity={aiDensity}
        aiDetail={aiDetail}
        hiddenAiAirlines={replacedAi ? [replacedAi] : []}
        onAiStats={setAiStats}
        getClock={getMapClock}
        mapRate={mapSpeed === 'live' ? 1 : ECONOMY_RATE[econSpeed] * 60}
        planeInfoEnabled={!inspectedAirport && !routeFrom}
        onBlockedPlaneClick={onBlockedPlaneClick}
        customIcons={customIcons}
        navaidsVersion={navaidsVersion}
        mapRef={mapRef}
      />

      <TopBar
        airlineName={airlineName}
        airlineIata={airlineIata}
        hubs={hubs}
        gameMode={gameMode}
        cash={cash}
        mapClock={mapClock}
        mapSpeed={mapSpeed}
        onMapSpeed={setMapSpeed}
        econMin={econ.min}
        econSpeed={econSpeed}
        onEconSpeed={setEconSpeed}
        weekSoFar={econ.current}
        lastWeek={ledgerHistory[ledgerHistory.length - 1] ?? null}
        money={topBarMoney}
        onOpenAirline={() => setPanel(groupOfPanel(panel) === 'airline' ? null : 'stats')}
        onOpenDebt={() => {
          if (career.insolvent) return setShowSettlement(true);
          setBankTab('loans');
          setPanel('bank');
        }}
      />
      {/* Map layers: the round button above the zoom buttons */}
      <LayersMenu
        mapStyle={mapStyle}
        onMapStyle={setMapStyle}
        globe={globe}
        onGlobe={setGlobe}
        threeD={threeD}
        onThreeD={setThreeD}
        detailed3d={detailed3d}
        onDetailed3d={setDetailed3d}
        globeAvailable={maplibreHasGlobe()}
        showApproaches={showApproaches}
        onShowApproaches={setShowApproaches}
        showNavaids={showNavaids}
        onShowNavaids={setShowNavaids}
        showAllRoutes={showAllRoutes}
        onShowAllRoutes={setShowAllRoutes}
        showWeather={showWeatherRadar}
        onShowWeather={setShowWeatherRadar}
        aiAvailable={aiTraffic !== null}
        aiDensity={aiDensity}
        onAiDensity={setAiDensity}
        aiAirborne={aiStats.airborne}
        aiDrawn={aiStats.drawn}
        aiBudget={aiStats.budget}
        aiDetail={aiDetail}
        onAiDetail={setAiDetail}
        aiNote={replacedAi ? `${(aiTraffic?.airlines ?? AI_AIRLINES).find((a) => a.code === replacedAi)?.name ?? replacedAi} is off the map: your airline takes its place.` : undefined}
        aiStatus={aiStatus}
        planeIconScale={planeIconScale}
        onPlaneIconScale={setPlaneIconScale}
      />

      <NavRail
        activePanel={panel}
        fleetCount={fleet.length}
        bankBadge={bankBadge}
        onOpen={setPanel}
        onOpenGroup={openGroup}
        onSave={saveCareer}
        onMenu={() => setMenuOpen(true)}
        version={APP_VERSION}
      />
      <CloudHost openSaveId={activeSaveId} onSlotsChanged={() => setSavedGames(readSaveSlots())} toast={flashToast} />
      {menuOpen && (
        <MainMenu
          onCloud={() => {
            setMenuOpen(false);
            openCloud();
          }}
          airlineCallsign={airlineCallsign}
          onAirlineDetails={(nameRaw, callRaw) => {
            const name = nameRaw.trim().replace(/\s+/g, ' ');
            const call = callRaw.trim().toUpperCase().replace(/\s+/g, ' ');
            if (!/^[\p{L}\p{N} .,'&-]{2,40}$/u.test(name)) return 'The name needs 2 to 40 letters, digits, spaces or . , \' & -';
            if (!/^[A-Z0-9 ]{2,20}$/.test(call)) return 'The callsign needs 2 to 20 letters, digits or spaces.';
            setAirlineName(name);
            setAirlineCallsign(call);
            flashToast(`Now flying as ${name}, callsign ${call}`);
            return null;
          }}
          airlineName={airlineName}
          version={APP_VERSION}
          onClose={() => setMenuOpen(false)}
          onSave={saveCareer}
          onExport={() => downloadSaveFile(currentSaveState())}
          onTour={() => {
            resetTransientUi();
            setTourOpen(true);
          }}
          onLeave={() => {
            setMenuOpen(false);
            persistCareer(true); // so catch-up starts from now when you resume
            resetTransientUi();
            setScreen('home');
          }}
        />
      )}
      {tourOpen && (
        <WelcomeTour
          airlineName={airlineName}
          hubIata={hubIata}
          sandbox={gameMode === 'sandbox'}
          onClose={() => setTourOpen(false)}
          onOpenBuy={() => setPanel('buy')}
        />
      )}

      {routeFrom && !inspectedAirport && (
        <RouteFromBar
          airport={routeFrom}
          isHub={hubs.includes(routeFrom.iata_code)}
          onDetails={() => {
            setInspectedAirport(routeFrom);
            setRouteFrom(null);
          }}
          onCancel={() => setRouteFrom(null)}
        />
      )}
      {inspectedAirport && (
        <AirportDrawer
          airport={inspectedAirport}
          airportByIata={airportByIata}
          hubs={hubs}
          fleet={fleet}
          schedule={schedule}
          simDay={mapClock.day}
          simMin={mapClock.min}
          dayOfMonth={mapClock.dayOfMonth}
          airlineIata={airlineIata}
          draft={draft}
          updateDraft={updateDraft}
          onPickAircraft={pickAircraft}
          onPlanResult={applyPlan}
          onBuyHub={buyHub}
          onSellHub={sellHub}
          onOpenSchedule={openSchedule}
          onBuyAircraft={() => setPanel('buy')}
          bulkTails={bulkTails}
          onBulkPlan={applyBulkPlan}
          onEndBulk={() => setBulkTails(null)}
          onClose={() => setInspectedAirport(null)}
        />
      )}

      <PanelTabsContext.Provider
        value={
          groupOfPanel(panel) && panel
            ? { group: PANEL_GROUPS[groupOfPanel(panel)!].label, tabs: PANEL_GROUPS[groupOfPanel(panel)!].tabs, active: panel, onPick: (id) => setPanel(id as PanelId) }
            : null
        }
      >
      {panel === 'fleet' && (
        <FleetPanel
          fleet={fleet}
          schedule={schedule}
          catalog={BUILTIN_AIRCRAFT}
          econMin={econ.min}
          cash={cash}
          sandbox={gameMode === 'sandbox'}
          onOpenSchedule={(tail) => openSchedule(tail, null)}
          onScheduleTogether={startBulkSchedule}
          onSellOrReturn={sellOrReturnAircraft}
          onBuyOut={buyOutLease}
          onRename={renameAircraft}
          onReRegister={reRegisterAircraft}
          onRefit={refitAircraft}
          onReplace={replaceAircraft}
          onBuy={() => setPanel('buy')}
          iconForModel={iconForModel}
          onClose={closePanel}
        />
      )}
      {panel === 'buy' && (
        <BuyAircraftPanel
          catalog={BUILTIN_AIRCRAFT}
          cash={cash}
          gameMode={gameMode}
          hubIata={hubIata}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          cabinDraft={cabinDraft}
          onCabinDraftChange={setCabinDraft}
          tailInput={tailInput}
          onTailInputChange={setTailInput}
          onAcquire={acquireAircraft}
          econMin={econ.min}
          iconForModel={iconForModel}
          onClose={closePanel}
        />
      )}
      {panel === 'schedule' && (
        <SchedulePanel
          schedule={schedule}
          fleet={fleet}
          hubs={hubs}
          primaryHub={hubIata}
          airportByIata={airportByIata}
          econById={econById}
          onEdit={openSchedule}
          onDelete={deleteFlightWithPair}
          onClose={closePanel}
        />
      )}
      {panel === 'bank' && (
        <BankPanel
          key={bankTab}
          career={career}
          metrics={careerMetrics}
          fleet={fleet}
          cash={cash}
          gameMode={gameMode}
          econMin={econ.min}
          initialTab={bankTab}
          ledgerHistory={ledgerHistory}
          onTakeLoan={takeLoan}
          onRepay={repayLoan}
          onRepayPart={repayLoanPartNow}
          onOpenSettlement={() => setShowSettlement(true)}
          onCollect={collectLetter}
          onRead={markLetterRead}
          onClose={closePanel}
        />
      )}
      {gameMode === 'standard' && !panel && !inspectedAirport && !hideMilestoneCard && (
        <MilestoneCard
          career={career}
          metrics={careerMetrics}
          onOpen={() => {
            setBankTab('programme');
            setPanel('bank');
          }}
          onHide={() => {
            setHideMilestoneCard(true);
            writePrefs({ hideMilestoneCard: true });
            flashToast('Milestone card hidden. Your progress is always in the Bank panel.');
          }}
        />
      )}
      {panel === 'stats' && (
        <StatsPanel
          airlineName={airlineName}
          fleet={fleet}
          schedule={schedule}
          econById={econById}
          hubs={hubs}
          airportByIata={airportByIata}
          ledgerHistory={ledgerHistory}
          current={econ.current}
          cash={cash}
          sandbox={gameMode === 'sandbox'}
          onClose={closePanel}
          onOpenAirports={() => setPanel('airports')}
        />
      )}
      {panel === 'airports' && (
        <AirportsPanel airports={airports} hubs={hubs} onInspect={showAirportOnMap} onBuy={buyHub} onSell={sellHub} onClose={closePanel} />
      )}

      </PanelTabsContext.Provider>

      {modalAircraft && scheduleModal && (
          <AircraftScheduleModal
            key={modalAircraft.tailNumber}
            aircraft={modalAircraft}
            allSchedule={schedule}
            playerHubs={hubs}
            fleet={fleet}
            initialSelectedFlightId={scheduleModal.flightId}
            radarIconUrl={iconForModel(modalAircraft.model)}
            onClose={() => setScheduleModal(null)}
            onUpdateFlight={updateFlight}
            onDeleteFlight={deleteFlightWithPair}
            onSellOrReturnAircraft={sellOrReturnAircraft}
          />
        )}

      {awayReport && <AwayReportModal report={awayReport} gameMode={gameMode} onClose={() => setAwayReport(null)} />}
      {gameMode === 'standard' && career.insolvent && showSettlement && !awayReport && (
        <BankruptcyModal
          key={career.insolvent.econMin}
          career={career}
          fleet={fleet}
          cash={cash}
          weeklyProfitByTail={weeklyProfitByTail}
          scheduledTails={scheduledTails}
          onSettle={(route, tails) => {
            settleInsolvency(route, tails);
            setShowSettlement(false);
          }}
          onLater={() => {
            setShowSettlement(false);
            flashToast('The bank lends nothing until you settle. Click Insolvent in the top bar when you are ready.', 5000);
          }}
        />
      )}
      {overlays}
    </div>
  );
}
