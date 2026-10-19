// ============================================================================
// AIRCRAFT CATALOG (unified 5-tier system)
// Tuple layout is documented on RawAcTuple; prices are in millions of USD.
// ============================================================================
import type { AircraftModel, OperationalTier } from './types';

type RawAcTuple = [
  string,                    // 0: id
  string,                    // 1: name
  string,                    // 2: manufacturer
  string,                    // 3: family
  OperationalTier,           // 4: tier (1..5)
  boolean,                   // 5: is_cargo
  number,                    // 6: cargo_cap_tons (metric tons)
  AircraftModel['category'], // 7: category
  string,                    // 8: icao_code
  number,                    // 9: range_nm
  number,                    // 10: cruise_speed_kts
  number,                    // 11: min_runway_ft
  number,                    // 12: max_exit_limit
  number,                    // 13: typical_seats
  number,                    // 14: cabin_width_m
  number,                    // 15: usable_cabin_length_m
  number,                    // 16: max_abreast
  number,                    // 17: fuel_burn_kg_hr
  number,                    // 18: mtow_kg
  number,                    // 19: base_price_usd (in Millions)
  number,                    // 20: daily_lease_usd
  number                     // 21: turnaround_min
];

const RAW_AIRCRAFT_CATALOG: RawAcTuple[] = [
  // ================= AIRBUS =================
  // A220 Family (Tier 3)
  ['a220-100', 'Airbus A220-100', 'Airbus', 'A220 Family', 3, false, 2.5, 'narrowbody', 'BCS1', 3450, 450, 4800, 135, 110, 3.28, 23.7, 5, 1650, 63100, 81.0, 14000, 40],
  ['a220-300', 'Airbus A220-300', 'Airbus', 'A220 Family', 3, false, 3.2, 'narrowbody', 'BCS3', 3550, 450, 6000, 160, 140, 3.28, 27.5, 5, 1850, 70900, 91.5, 15800, 45],
  // A320 Family (Tier 3 + P2F Freighters)
  ['a318-100', 'Airbus A318-100 Elite', 'Airbus', 'A320 Family', 3, false, 2.0, 'narrowbody', 'A318', 3100, 450, 5900, 132, 107, 3.7, 21.38, 6, 2100, 68000, 56.0, 9800, 40],
  ['a319-100', 'Airbus A319-100ceo', 'Airbus', 'A320 Family', 3, false, 2.8, 'narrowbody', 'A319', 3750, 450, 6100, 156, 124, 3.7, 23.78, 6, 2250, 75500, 72.0, 12500, 40],
  ['a319neo', 'Airbus A319neo', 'Airbus', 'A320 Family', 3, false, 3.0, 'narrowbody', 'A19N', 3750, 450, 6000, 160, 140, 3.7, 23.78, 6, 1900, 75500, 101.5, 17500, 40],
  ['a320-200', 'Airbus A320-200ceo', 'Airbus', 'A320 Family', 3, false, 3.8, 'narrowbody', 'A320', 3300, 450, 6500, 180, 150, 3.7, 27.5, 6, 2400, 78000, 82.0, 14200, 45],
  ['a320neo', 'Airbus A320neo', 'Airbus', 'A320 Family', 3, false, 4.0, 'narrowbody', 'A20N', 3500, 450, 6400, 194, 165, 3.7, 27.5, 6, 2050, 79000, 110.6, 19000, 45],
  ['a320-p2f', 'Airbus A320P2F (Cargo)', 'Airbus', 'A320 Family', 3, true, 21.0, 'narrowbody', 'A320', 2100, 448, 6500, 0, 0, 3.7, 27.5, 6, 2450, 78000, 48.0, 8900, 50],
  ['a321-200', 'Airbus A321-200ceo', 'Airbus', 'A320 Family', 3, false, 4.8, 'narrowbody', 'A321', 3200, 450, 7100, 220, 185, 3.7, 34.44, 6, 2750, 93500, 96.0, 16800, 50],
  ['a321neo', 'Airbus A321neo', 'Airbus', 'A320 Family', 3, false, 5.2, 'narrowbody', 'A21N', 4000, 450, 7200, 244, 196, 3.7, 34.44, 6, 2400, 97000, 129.5, 22500, 50],
  ['a321lr', 'Airbus A321LR', 'Airbus', 'A320 Family', 3, false, 4.5, 'narrowbody', 'A21N', 4000, 450, 7400, 244, 188, 3.7, 34.44, 6, 2420, 97000, 135.0, 23500, 50],
  ['a321xlr', 'Airbus A321XLR', 'Airbus', 'A320 Family', 3, false, 4.2, 'narrowbody', 'A21N', 4700, 450, 7800, 244, 182, 3.7, 34.44, 6, 2450, 101000, 142.0, 25000, 55],
  ['a321-p2f', 'Airbus A321P2F (Cargo)', 'Airbus', 'A320 Family', 3, true, 28.0, 'narrowbody', 'A321', 2300, 448, 7200, 0, 0, 3.7, 34.44, 6, 2750, 93500, 62.0, 11200, 55],
  // A300 / A310 Classic Widebody Family (Tier 4)
  ['a310-300', 'Airbus A310-300', 'Airbus', 'A300 / A310 Family', 4, false, 11.0, 'widebody', 'A310', 5150, 458, 8000, 280, 220, 5.28, 33.2, 8, 4400, 164000, 78.0, 13800, 65],
  ['a300-600r', 'Airbus A300-600R', 'Airbus', 'A300 / A310 Family', 4, false, 14.0, 'widebody', 'A306', 4050, 460, 8100, 360, 266, 5.28, 40.7, 8, 4900, 171700, 92.0, 16200, 70],
  ['a300-600f', 'Airbus A300-600F (Cargo)', 'Airbus', 'A300 / A310 Family', 4, true, 48.0, 'widebody', 'A306', 2950, 455, 8100, 0, 0, 5.28, 40.7, 8, 5000, 171700, 88.0, 15500, 75],
  // A330 Family (Tier 4)
  ['a330-200', 'Airbus A330-200', 'Airbus', 'A330 Family', 4, false, 16.5, 'widebody', 'A332', 7250, 475, 8200, 406, 247, 5.28, 45.0, 8, 5200, 242000, 210.0, 36500, 75],
  ['a330-200f', 'Airbus A330-200F (Cargo)', 'Airbus', 'A330 Family', 4, true, 70.0, 'widebody', 'A332', 4000, 470, 8400, 0, 0, 5.28, 45.0, 8, 5400, 233000, 225.0, 39000, 85],
  ['a330-300', 'Airbus A330-300', 'Airbus', 'A330 Family', 4, false, 18.5, 'widebody', 'A333', 6350, 475, 8500, 440, 277, 5.28, 50.35, 8, 5500, 242000, 238.0, 41500, 75],
  ['a330-800neo', 'Airbus A330-800neo', 'Airbus', 'A330 Family', 4, false, 17.0, 'widebody', 'A338', 8150, 482, 8200, 406, 257, 5.28, 45.0, 8, 4500, 251000, 260.0, 45000, 75],
  ['a330-900neo', 'Airbus A330-900neo', 'Airbus', 'A330 Family', 4, false, 19.5, 'widebody', 'A339', 7200, 482, 8500, 440, 287, 5.28, 50.35, 9, 4800, 251000, 296.4, 52000, 75],
  // A350 Family (Tier 4 & Tier 5)
  ['a350-900', 'Airbus A350-900', 'Airbus', 'A350 Family', 4, false, 21.0, 'widebody', 'A359', 8100, 488, 8500, 440, 315, 5.61, 51.04, 9, 5400, 280000, 317.4, 55000, 85],
  ['a350-900ulr', 'Airbus A350-900ULR', 'Airbus', 'A350 Family', 4, false, 16.0, 'widebody', 'A359', 9700, 488, 8900, 440, 170, 5.61, 51.04, 9, 5450, 280000, 336.0, 58000, 85],
  ['a350-1000', 'Airbus A350-1000', 'Airbus', 'A350 Family', 5, false, 25.0, 'widebody', 'A35K', 8700, 488, 9800, 480, 369, 5.61, 57.94, 9, 6200, 319000, 366.5, 64000, 90],
  ['a350f', 'Airbus A350F (Cargo)', 'Airbus', 'A350 Family', 5, true, 111.0, 'widebody', 'A35K', 4700, 485, 9800, 0, 0, 5.61, 57.94, 9, 6400, 319000, 372.0, 65000, 95],
  // A340 Quad-Jet Family (Tier 5)
  ['a340-300', 'Airbus A340-300', 'Airbus', 'A340 Family', 5, false, 18.0, 'heavy_widebody', 'A343', 7400, 475, 9850, 440, 295, 5.28, 50.35, 9, 6500, 276500, 215.0, 38000, 85],
  ['a340-500', 'Airbus A340-500HGW', 'Airbus', 'A340 Family', 5, false, 19.5, 'heavy_widebody', 'A345', 9000, 482, 10200, 375, 313, 5.28, 53.5, 9, 7600, 380000, 245.0, 43000, 90],
  ['a340-600', 'Airbus A340-600', 'Airbus', 'A340 Family', 5, false, 22.5, 'heavy_widebody', 'A346', 7800, 482, 10499, 475, 370, 5.28, 60.95, 9, 7800, 380000, 275.0, 48000, 95],
  // A380 Superjumbo Family (Tier 5)
  ['a380-800', 'Airbus A380-800', 'Airbus', 'A380 Family', 5, false, 18.0, 'heavy_widebody', 'A388', 8000, 490, 9800, 853, 555, 6.54, 99.0, 10, 11500, 575000, 445.6, 78000, 120],

  // ================= BOEING =================
  // 717 Family (Tier 3)
  ['b717-200', 'Boeing 717-200', 'Boeing', '717 Family', 3, false, 2.0, 'narrowbody', 'B712', 2060, 438, 5800, 134, 110, 3.14, 24.0, 5, 1950, 54884, 42.0, 7600, 35],
  // 737 Family (Tier 3)
  ['b737-200', 'Boeing 737-200 Adv', 'Boeing', '737 Family', 3, false, 2.2, 'narrowbody', 'B732', 2300, 430, 5900, 136, 115, 3.54, 20.8, 6, 2650, 58100, 28.0, 5200, 40],
  ['b737-300', 'Boeing 737-300 Classic', 'Boeing', '737 Family', 3, false, 2.8, 'narrowbody', 'B733', 2255, 430, 6100, 149, 128, 3.54, 24.13, 6, 2400, 62820, 44.0, 8100, 40],
  ['b737-300sf', 'Boeing 737-300SF (Cargo)', 'Boeing', '737 Family', 3, true, 19.5, 'narrowbody', 'B733', 1630, 428, 6100, 0, 0, 3.54, 24.13, 6, 2450, 62820, 34.0, 6400, 45],
  ['b737-400', 'Boeing 737-400 Classic', 'Boeing', '737 Family', 3, false, 3.4, 'narrowbody', 'B734', 2060, 430, 6500, 188, 146, 3.54, 27.2, 6, 2550, 68040, 52.0, 9400, 45],
  ['b737-500', 'Boeing 737-500 Classic', 'Boeing', '737 Family', 3, false, 2.4, 'narrowbody', 'B735', 2400, 430, 6000, 145, 110, 3.54, 21.7, 6, 2300, 60550, 39.0, 7200, 40],
  ['b737-700', 'Boeing 737-700 NG', 'Boeing', '737 Family', 3, false, 3.0, 'narrowbody', 'B737', 3010, 453, 6000, 149, 128, 3.54, 24.13, 6, 2200, 70080, 89.0, 15000, 45],
  ['b737-800', 'Boeing 737-800 NG', 'Boeing', '737 Family', 3, false, 4.0, 'narrowbody', 'B738', 2935, 453, 6800, 189, 162, 3.54, 30.0, 6, 2450, 79010, 106.0, 18000, 50],
  ['b737-800bcf', 'Boeing 737-800BCF (Cargo)', 'Boeing', '737 Family', 3, true, 23.9, 'narrowbody', 'B738', 2000, 450, 6800, 0, 0, 3.54, 30.0, 6, 2500, 79010, 68.0, 12000, 50],
  ['b737-max7', 'Boeing 737 MAX 7', 'Boeing', '737 Family', 3, false, 3.2, 'narrowbody', 'B37M', 3800, 453, 6200, 172, 138, 3.54, 26.0, 6, 1950, 80286, 102.0, 17800, 45],
  ['b737-max8', 'Boeing 737 MAX 8', 'Boeing', '737 Family', 3, false, 4.2, 'narrowbody', 'B38M', 3550, 453, 6600, 189, 162, 3.54, 30.0, 6, 2100, 82190, 121.6, 20500, 50],
  ['b737-900er', 'Boeing 737-900ER NG', 'Boeing', '737 Family', 3, false, 4.5, 'narrowbody', 'B739', 2950, 453, 7200, 220, 178, 3.54, 32.66, 6, 2600, 85130, 112.0, 19200, 50],
  ['b737-max9', 'Boeing 737 MAX 9', 'Boeing', '737 Family', 3, false, 4.6, 'narrowbody', 'B39M', 3300, 453, 7100, 220, 180, 3.54, 32.66, 6, 2250, 88310, 128.9, 22000, 50],
  ['b737-max10', 'Boeing 737 MAX 10', 'Boeing', '737 Family', 3, false, 5.0, 'narrowbody', 'B3XM', 3100, 453, 7500, 230, 192, 3.54, 34.3, 6, 2350, 89765, 134.9, 23200, 55],
  // 757 Family (Tier 3)
  ['b757-200', 'Boeing 757-200', 'Boeing', '757 Family', 3, false, 5.5, 'narrowbody', 'B752', 3915, 460, 7000, 239, 192, 3.54, 36.0, 6, 3200, 115680, 65.0, 11000, 55],
  ['b757-200pcf', 'Boeing 757-200PCF (Cargo)', 'Boeing', '757 Family', 3, true, 36.0, 'narrowbody', 'B752', 3150, 458, 7000, 0, 0, 3.54, 36.0, 6, 3250, 115680, 58.0, 10200, 60],
  ['b757-300', 'Boeing 757-300', 'Boeing', '757 Family', 3, false, 6.2, 'narrowbody', 'B753', 3400, 460, 7800, 295, 243, 3.54, 43.1, 6, 3550, 123600, 76.0, 13200, 60],
  // 767 Family (Tier 4)
  ['b767-200er', 'Boeing 767-200ER', 'Boeing', '767 Family', 4, false, 12.0, 'widebody', 'B762', 6590, 460, 8000, 290, 216, 4.72, 33.9, 7, 4400, 179170, 128.0, 22500, 65],
  ['b767-300er', 'Boeing 767-300ER', 'Boeing', '767 Family', 4, false, 15.0, 'widebody', 'B763', 5980, 460, 8200, 351, 261, 4.72, 40.4, 7, 4800, 186880, 165.0, 28500, 70],
  ['b767-300f', 'Boeing 767-300F (Cargo)', 'Boeing', '767 Family', 4, true, 52.7, 'widebody', 'B763', 3255, 458, 8200, 0, 0, 4.72, 40.4, 7, 4900, 186880, 185.0, 32000, 75],
  ['b767-400er', 'Boeing 767-400ER', 'Boeing', '767 Family', 4, false, 17.5, 'widebody', 'B764', 5625, 460, 8800, 375, 296, 4.72, 46.8, 7, 5150, 204120, 192.0, 33500, 75],
  // 787 Dreamliner Family (Tier 4)
  ['b787-8', 'Boeing 787-8 Dreamliner', 'Boeing', '787 Dreamliner Family', 4, false, 17.0, 'widebody', 'B788', 7355, 488, 8200, 381, 242, 5.49, 42.3, 9, 4600, 227930, 248.3, 44000, 75],
  ['b787-9', 'Boeing 787-9 Dreamliner', 'Boeing', '787 Dreamliner Family', 4, false, 20.5, 'widebody', 'B789', 7635, 488, 8500, 420, 290, 5.49, 48.4, 9, 5100, 254011, 292.5, 51000, 80],
  ['b787-10', 'Boeing 787-10 Dreamliner', 'Boeing', '787 Dreamliner Family', 4, false, 23.0, 'widebody', 'B78X', 6430, 488, 9100, 440, 330, 5.49, 54.0, 9, 5500, 254011, 338.4, 59000, 85],
  // 777 Family (Tier 4 & Tier 5)
  ['b777-200er', 'Boeing 777-200ER', 'Boeing', '777 Family', 4, false, 21.0, 'widebody', 'B772', 7065, 482, 8500, 440, 313, 5.86, 49.1, 10, 6700, 297550, 258.0, 45000, 85],
  ['b777-200lr', 'Boeing 777-200LR Worldliner', 'Boeing', '777 Family', 4, false, 19.5, 'widebody', 'B77L', 8555, 482, 9200, 440, 301, 5.86, 49.1, 10, 6900, 347450, 315.0, 54500, 90],
  ['b777f', 'Boeing 777F (Cargo)', 'Boeing', '777 Family', 4, true, 102.0, 'widebody', 'B77L', 4970, 480, 9200, 0, 0, 5.86, 49.1, 10, 7000, 347810, 335.0, 58000, 95],
  ['b777-300er', 'Boeing 777-300ER', 'Boeing', '777 Family', 5, false, 26.5, 'heavy_widebody', 'B77W', 7370, 482, 9850, 550, 396, 5.86, 59.8, 10, 7800, 351530, 375.5, 66000, 95],
  ['b777-9', 'Boeing 777-9 (777X)', 'Boeing', '777 Family', 5, false, 28.0, 'heavy_widebody', 'B779', 7285, 485, 10000, 475, 426, 5.96, 62.8, 10, 7100, 351500, 442.2, 76500, 95],
  ['b777-8f', 'Boeing 777-8F (Cargo)', 'Boeing', '777 Family', 5, true, 112.3, 'heavy_widebody', 'B778', 4410, 482, 9900, 0, 0, 5.96, 54.9, 10, 6950, 365140, 418.0, 72500, 95],
  // 747 Jumbo Family (Tier 5)
  ['b747-200b', 'Boeing 747-200B Classic', 'Boeing', '747 Jumbo Family', 5, false, 20.0, 'heavy_widebody', 'B742', 6560, 485, 10200, 550, 412, 6.1, 56.5, 10, 11200, 377840, 148.0, 26500, 105],
  ['b747-400', 'Boeing 747-400', 'Boeing', '747 Jumbo Family', 5, false, 22.0, 'heavy_widebody', 'B744', 7260, 493, 9900, 660, 416, 6.1, 57.0, 10, 10200, 396890, 260.0, 46000, 105],
  ['b747-400f', 'Boeing 747-400F (Cargo)', 'Boeing', '747 Jumbo Family', 5, true, 112.7, 'heavy_widebody', 'B744', 4445, 490, 10000, 0, 0, 6.1, 57.0, 10, 10300, 396890, 255.0, 45000, 110],
  ['b747-8i', 'Boeing 747-8 Intercontinental', 'Boeing', '747 Jumbo Family', 5, false, 25.0, 'heavy_widebody', 'B748', 7730, 495, 10200, 605, 467, 6.1, 63.6, 10, 9800, 447700, 418.4, 72000, 110],
  ['b747-8f', 'Boeing 747-8F (Cargo)', 'Boeing', '747 Jumbo Family', 5, true, 137.7, 'heavy_widebody', 'B748', 4120, 492, 10200, 0, 0, 6.1, 63.6, 10, 9950, 447700, 419.2, 72500, 115],

  // ================= EMBRAER =================
  ['erj-145', 'Embraer ERJ-145LR', 'Embraer', 'ERJ Family', 2, false, 0.8, 'regional_jet', 'E145', 1550, 447, 4900, 50, 50, 2.1, 16.5, 3, 1080, 22000, 24.0, 4600, 30],
  ['e170', 'Embraer E170', 'Embraer', 'E-Jet Family', 2, false, 1.4, 'regional_jet', 'E170', 2150, 447, 4800, 78, 70, 2.74, 18.5, 4, 1400, 38600, 41.0, 7500, 35],
  ['e175', 'Embraer E175', 'Embraer', 'E-Jet Family', 2, false, 1.6, 'regional_jet', 'E175', 2200, 447, 5200, 88, 76, 2.74, 20.2, 4, 1500, 40370, 48.0, 8900, 40],
  ['e190', 'Embraer E190', 'Embraer', 'E-Jet Family', 2, false, 2.2, 'regional_jet', 'E190', 2450, 447, 5500, 114, 100, 2.74, 24.5, 4, 1750, 51800, 54.0, 9800, 40],
  ['e190f', 'Embraer E190F (Cargo)', 'Embraer', 'E-Jet Family', 2, true, 13.5, 'regional_jet', 'E190', 2300, 445, 5500, 0, 0, 2.74, 24.5, 4, 1780, 51800, 38.0, 7100, 40],
  ['e195-e2', 'Embraer E195-E2', 'Embraer', 'E-Jet E2 Family', 2, false, 2.8, 'regional_jet', 'E295', 2600, 470, 5700, 146, 132, 2.74, 28.1, 4, 1680, 61500, 72.0, 12500, 45],

  // ================= BOMBARDIER =================
  ['crj-200', 'Bombardier CRJ-200ER', 'Bombardier', 'CRJ Family', 2, false, 0.9, 'regional_jet', 'CRJ2', 1700, 444, 5200, 50, 50, 2.57, 14.8, 4, 1120, 24040, 22.0, 4200, 30],
  ['crj-700', 'Bombardier CRJ-700', 'Bombardier', 'CRJ Family', 2, false, 1.4, 'regional_jet', 'CRJ7', 1400, 447, 5250, 78, 70, 2.57, 18.5, 4, 1350, 34019, 38.0, 6900, 35],
  ['crj-900', 'Bombardier CRJ-900', 'Bombardier', 'CRJ Family', 2, false, 1.8, 'regional_jet', 'CRJ9', 1550, 450, 5600, 90, 76, 2.57, 21.1, 4, 1450, 38330, 46.0, 8500, 40],
  ['crj-1000', 'Bombardier CRJ-1000', 'Bombardier', 'CRJ Family', 2, false, 2.1, 'regional_jet', 'CRJX', 1650, 450, 5750, 104, 100, 2.57, 23.9, 4, 1560, 41640, 51.0, 9200, 40],

  // ================= ATR =================
  ['atr-42-600', 'ATR 42-600', 'ATR', 'ATR 42 / 72 Family', 1, false, 0.9, 'turboprop', 'AT46', 716, 300, 3445, 50, 48, 2.57, 13.85, 4, 600, 18600, 22.0, 4800, 30],
  ['atr-72-600', 'ATR 72-600', 'ATR', 'ATR 42 / 72 Family', 1, false, 1.4, 'turboprop', 'AT76', 740, 275, 4373, 78, 72, 2.57, 19.21, 4, 780, 23000, 26.0, 5800, 35],
  ['atr-72-600f', 'ATR 72-600F (Cargo)', 'ATR', 'ATR 42 / 72 Family', 1, true, 9.2, 'turboprop', 'AT76', 900, 275, 4373, 0, 0, 2.57, 19.21, 4, 790, 23000, 27.5, 6000, 35],

  // ================= DE HAVILLAND =================
  ['dhc6-400', 'DHC-6 Twin Otter Series 400', 'De Havilland', 'Twin Otter STOL Family', 1, false, 0.4, 'turboprop', 'DHC6', 799, 170, 1200, 19, 19, 1.61, 5.64, 3, 270, 5670, 7.5, 1600, 20],
  ['dash8-100', 'De Havilland Dash 8-100', 'De Havilland', 'Dash 8 Family', 1, false, 0.8, 'turboprop', 'DH8A', 1020, 270, 3280, 39, 37, 2.51, 11.8, 4, 540, 15650, 16.5, 3500, 25],
  ['dash8-q400', 'De Havilland Dash 8-Q400', 'De Havilland', 'Dash 8 Family', 1, false, 1.5, 'turboprop', 'DH8D', 1100, 360, 4675, 90, 78, 2.51, 18.8, 4, 1050, 29574, 32.0, 6200, 30],
  ['dash8-q400pf', 'De Havilland Dash 8-Q400PF (Cargo)', 'De Havilland', 'Dash 8 Family', 1, true, 9.0, 'turboprop', 'DH8D', 1120, 358, 4675, 0, 0, 2.51, 18.8, 4, 1060, 29574, 33.5, 6500, 35],

  // ================= MCDONNELL DOUGLAS =================
  ['md-88', 'McDonnell Douglas MD-88', 'McDonnell Douglas', 'MD-80 / 90 Family', 3, false, 3.0, 'narrowbody', 'MD88', 2050, 438, 6500, 172, 149, 3.14, 30.8, 5, 2950, 67812, 32.0, 6100, 45],
  ['md-11', 'McDonnell Douglas MD-11', 'McDonnell Douglas', 'MD-11 Trijet Family', 4, false, 18.0, 'widebody', 'MD11', 6725, 473, 9500, 410, 293, 5.69, 46.5, 9, 7200, 273290, 145.0, 26000, 85],
  ['md-11f', 'McDonnell Douglas MD-11F (Cargo)', 'McDonnell Douglas', 'MD-11 Trijet Family', 4, true, 91.7, 'widebody', 'MD11', 3950, 470, 9500, 0, 0, 5.69, 46.5, 9, 7300, 285990, 152.0, 27500, 90],

  // ================= CHINESE JETS (COMAC / AVIC) =================
  ['xian-ma60', 'Xian MA60', 'COMAC / China', 'MA60 Turboprop Family', 1, false, 1.1, 'turboprop', 'MA60', 860, 278, 4250, 60, 56, 2.7, 15.2, 4, 680, 21800, 18.5, 3900, 30],
  ['comac-c909', 'COMAC C909 (ARJ21-700)', 'COMAC / China', 'C909 (ARJ21) Family', 2, false, 1.8, 'regional_jet', 'AJ27', 2000, 447, 5500, 95, 90, 3.14, 20.4, 5, 1650, 43500, 38.0, 7200, 40],
  ['comac-c909ccf', 'COMAC C909CCF (ARJ21 Cargo)', 'COMAC / China', 'C909 (ARJ21) Family', 2, true, 10.2, 'regional_jet', 'AJ27', 1800, 445, 5500, 0, 0, 3.14, 20.4, 5, 1680, 43500, 36.0, 6900, 40],
  ['comac-c919', 'COMAC C919-100ER', 'COMAC / China', 'C919 Narrowbody Family', 3, false, 3.8, 'narrowbody', 'C919', 3000, 450, 6500, 192, 164, 3.9, 28.2, 6, 2120, 78900, 99.0, 17200, 45],

  // ================= RUSSIAN / CIS JETS =================
  ['an-24rv', 'Antonov An-24RV', 'Russian / CIS', 'An-24 / An-26 Family', 1, false, 0.9, 'turboprop', 'AN24', 1000, 243, 3300, 52, 48, 2.76, 13.5, 4, 820, 21000, 11.0, 2400, 30],
  ['an-26b', 'Antonov An-26B (Cargo)', 'Russian / CIS', 'An-24 / An-26 Family', 1, true, 5.5, 'turboprop', 'AN26', 600, 237, 3600, 0, 0, 2.76, 13.5, 4, 860, 24000, 12.0, 2600, 35],
  ['sj-100', 'Sukhoi Superjet 100 (SJ-100LR)', 'Russian / CIS', 'Superjet SJ-100 Family', 2, false, 1.9, 'regional_jet', 'SU95', 2470, 447, 5600, 108, 98, 3.23, 21.2, 5, 1700, 49450, 36.0, 6800, 40],
  ['tu-204-100', 'Tupolev Tu-204-100V', 'Russian / CIS', 'Tu-204 / Tu-214 Family', 3, false, 4.5, 'narrowbody', 'T204', 2800, 458, 6600, 210, 190, 3.57, 33.4, 6, 3150, 105000, 52.0, 9500, 50],
  ['tu-204c', 'Tupolev Tu-204C (Cargo)', 'Russian / CIS', 'Tu-204 / Tu-214 Family', 3, true, 30.0, 'narrowbody', 'T204', 2100, 455, 6600, 0, 0, 3.57, 33.4, 6, 3200, 107500, 49.0, 9000, 55],
  ['tu-214', 'Tupolev Tu-214', 'Russian / CIS', 'Tu-204 / Tu-214 Family', 3, false, 4.8, 'narrowbody', 'T204', 3500, 458, 6800, 210, 194, 3.57, 33.4, 6, 3250, 110750, 58.0, 10500, 50],
  ['il-96-300', 'Ilyushin Il-96-300', 'Russian / CIS', 'Il-96 Quad-Widebody Family', 4, false, 16.0, 'heavy_widebody', 'IL96', 6200, 470, 8600, 300, 262, 5.7, 41.0, 9, 7300, 250000, 115.0, 21000, 80],
  ['il-96-400t', 'Ilyushin Il-96-400T (Cargo)', 'Russian / CIS', 'Il-96 Quad-Widebody Family', 4, true, 92.0, 'heavy_widebody', 'IL96', 2700, 468, 9200, 0, 0, 5.7, 49.5, 9, 7800, 270000, 128.0, 23500, 90],
  ['il-76td-90', 'Ilyushin Il-76TD-90VD (Cargo)', 'Russian / CIS', 'Il-76 / An-124 Outsized Cargo', 5, true, 50.0, 'heavy_widebody', 'IL76', 2700, 445, 9800, 0, 0, 3.45, 24.5, 6, 7500, 195000, 75.0, 14000, 85],
  ['an-124-100', 'Antonov An-124-100 Ruslan (Cargo)', 'Russian / CIS', 'Il-76 / An-124 Outsized Cargo', 5, true, 120.0, 'heavy_widebody', 'A124', 2800, 450, 10200, 0, 0, 6.4, 36.5, 10, 12600, 402000, 165.0, 29500, 115],
];

export const BUILTIN_AIRCRAFT: AircraftModel[] = RAW_AIRCRAFT_CATALOG.map((r) => ({
  id: r[0],
  name: r[1],
  manufacturer: r[2],
  family: r[3],
  tier: r[4],
  is_cargo: r[5],
  cargo_cap_tons: r[6],
  category: r[7],
  icao_code: r[8],
  range_nm: r[9],
  cruise_speed_kts: r[10],
  min_runway_ft: r[11],
  max_exit_limit: r[12],
  typical_seats: r[13],
  cabin_width_m: r[14],
  usable_cabin_length_m: r[15],
  max_abreast: r[16],
  fuel_burn_kg_hr: r[17],
  mtow_kg: r[18],
  base_price_usd: Math.round(r[19] * 1_000_000),
  daily_lease_usd: r[20],
  turnaround_min: r[21],
  image_key: r[0].replace(/-/g, '_'),
}));

export const AIRCRAFT_BY_ID = new Map(BUILTIN_AIRCRAFT.map((m) => [m.id, m]));

export const BRAND_ORDER = [
  'Airbus',
  'Boeing',
  'Embraer',
  'Bombardier',
  'ATR',
  'De Havilland',
  'McDonnell Douglas',
  'COMAC / China',
  'Russian / CIS',
];
