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
  ['a318-100', 'Airbus A318', 'Airbus', 'A320 Family', 3, false, 2.0, 'narrowbody', 'A318', 3100, 450, 5900, 132, 107, 3.7, 21.38, 6, 2100, 68000, 56.0, 9800, 40],
  ['a319-100', 'Airbus A319', 'Airbus', 'A320 Family', 3, false, 2.8, 'narrowbody', 'A319', 3750, 450, 6100, 156, 124, 3.7, 23.78, 6, 2250, 75500, 72.0, 12500, 40],
  ['a319neo', 'Airbus A319neo', 'Airbus', 'A320 Family', 3, false, 3.0, 'narrowbody', 'A19N', 3750, 450, 6000, 160, 140, 3.7, 23.78, 6, 1900, 75500, 101.5, 17500, 40],
  ['a320-200', 'Airbus A320', 'Airbus', 'A320 Family', 3, false, 3.8, 'narrowbody', 'A320', 3300, 450, 6500, 180, 150, 3.7, 27.5, 6, 2400, 78000, 82.0, 14200, 45],
  ['a320neo', 'Airbus A320neo', 'Airbus', 'A320 Family', 3, false, 4.0, 'narrowbody', 'A20N', 3500, 450, 6400, 194, 165, 3.7, 27.5, 6, 2050, 79000, 110.6, 19000, 45],
  ['a320-p2f', 'Airbus A320P2F (Cargo)', 'Airbus', 'A320 Family', 3, true, 21.0, 'narrowbody', 'A320', 2100, 448, 6500, 0, 0, 3.7, 27.5, 6, 2450, 78000, 48.0, 8900, 50],
  ['a321-200', 'Airbus A321-200', 'Airbus', 'A320 Family', 3, false, 4.8, 'narrowbody', 'A321', 3200, 450, 7100, 220, 185, 3.7, 34.44, 6, 2750, 93500, 96.0, 16800, 50],
  ['a321-100', 'Airbus A321-100', 'Airbus', 'A320 Family', 3, false, 4.5, 'narrowbody', 'A321', 2300, 450, 6900, 220, 185, 3.7, 34.44, 6, 2700, 83000, 70.0, 12300, 50],
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
  ['a330-300p2f', 'Airbus A330-300P2F (Cargo)', 'Airbus', 'A330 Family', 4, true, 61.0, 'widebody', 'A333', 3650, 470, 8400, 0, 0, 5.28, 50.35, 8, 5500, 233000, 150.0, 26000, 85],
  ['a330-300', 'Airbus A330-300', 'Airbus', 'A330 Family', 4, false, 18.5, 'widebody', 'A333', 6350, 475, 8500, 440, 277, 5.28, 50.35, 8, 5500, 242000, 238.0, 41500, 75],
  ['a330-800neo', 'Airbus A330-800', 'Airbus', 'A330 Family', 4, false, 17.0, 'widebody', 'A338', 8150, 482, 8200, 406, 257, 5.28, 45.0, 8, 4500, 251000, 260.0, 45000, 75],
  ['a330-900neo', 'Airbus A330-900', 'Airbus', 'A330 Family', 4, false, 19.5, 'widebody', 'A339', 7200, 482, 8500, 440, 287, 5.28, 50.35, 9, 4800, 251000, 296.4, 52000, 75],
  // A350 Family (Tier 4 & Tier 5)
  ['a350-900', 'Airbus A350-900', 'Airbus', 'A350 Family', 4, false, 21.0, 'widebody', 'A359', 8100, 488, 8500, 440, 315, 5.61, 51.04, 9, 5400, 280000, 317.4, 55000, 85],
  ['a350-900ulr', 'Airbus A350-900ULR', 'Airbus', 'A350 Family', 4, false, 16.0, 'widebody', 'A359', 9700, 488, 8900, 440, 170, 5.61, 51.04, 9, 5450, 280000, 336.0, 58000, 85],
  ['a350-1000', 'Airbus A350-1000', 'Airbus', 'A350 Family', 5, false, 25.0, 'widebody', 'A35K', 8700, 488, 9800, 480, 369, 5.61, 57.94, 9, 6200, 319000, 366.5, 64000, 90],
  ['a350-1000ulr', 'Airbus A350-1000ULR', 'Airbus', 'A350 Family', 5, false, 20.0, 'widebody', 'A35K', 9700, 488, 9800, 480, 238, 5.61, 57.94, 9, 6300, 322000, 380.0, 66500, 95],
  ['a350f', 'Airbus A350F (Cargo)', 'Airbus', 'A350 Family', 5, true, 111.0, 'widebody', 'A35K', 4700, 485, 9800, 0, 0, 5.61, 57.94, 9, 6400, 319000, 372.0, 65000, 95],
  // A340 Quad-Jet Family (Tier 5)
  ['a340-300', 'Airbus A340-300', 'Airbus', 'A340 Family', 5, false, 18.0, 'heavy_widebody', 'A343', 7400, 475, 9850, 440, 295, 5.28, 50.35, 9, 6500, 276500, 215.0, 38000, 85],
  ['a340-500', 'Airbus A340-500', 'Airbus', 'A340 Family', 5, false, 19.5, 'heavy_widebody', 'A345', 9000, 482, 10200, 375, 313, 5.28, 53.5, 9, 7600, 380000, 245.0, 43000, 90],
  ['a340-600', 'Airbus A340-600', 'Airbus', 'A340 Family', 5, false, 22.5, 'heavy_widebody', 'A346', 7800, 482, 10499, 475, 370, 5.28, 60.95, 9, 7800, 380000, 275.0, 48000, 95],
  // A380 Superjumbo Family (Tier 5)
  ['a380-800', 'Airbus A380-800', 'Airbus', 'A380 Family', 5, false, 18.0, 'heavy_widebody', 'A388', 8000, 490, 9800, 853, 555, 6.54, 99.0, 10, 11500, 575000, 445.6, 78000, 120],

  // ================= BOEING =================
  // 717 Family (Tier 3)
  ['b717-200', 'Boeing 717-200', 'Boeing', '717 Family', 3, false, 2.0, 'narrowbody', 'B712', 2060, 438, 5800, 134, 110, 3.14, 24.0, 5, 1950, 54884, 42.0, 7600, 35],
  // 737 Family (Tier 3)
  ['b737-200', 'Boeing 737-200 Advanced', 'Boeing', '737 Family', 3, false, 2.2, 'narrowbody', 'B732', 2300, 430, 5900, 136, 115, 3.54, 20.8, 6, 2650, 58100, 28.0, 5200, 40],
  ['b737-300', 'Boeing 737-300', 'Boeing', '737 Family', 3, false, 2.8, 'narrowbody', 'B733', 2255, 430, 6100, 149, 128, 3.54, 24.13, 6, 2400, 62820, 44.0, 8100, 40],
  ['b737-300sf', 'Boeing 737-300SF (Cargo)', 'Boeing', '737 Family', 3, true, 19.5, 'narrowbody', 'B733', 1630, 428, 6100, 0, 0, 3.54, 24.13, 6, 2450, 62820, 34.0, 6400, 45],
  ['b737-400', 'Boeing 737-400', 'Boeing', '737 Family', 3, false, 3.4, 'narrowbody', 'B734', 2060, 430, 6500, 188, 146, 3.54, 27.2, 6, 2550, 68040, 52.0, 9400, 45],
  ['b737-400sf', 'Boeing 737-400SF (Cargo)', 'Boeing', '737 Family', 3, true, 21.0, 'narrowbody', 'B734', 1700, 428, 6500, 0, 0, 3.54, 27.2, 6, 2550, 68040, 38.0, 7000, 45],
  ['b737-500', 'Boeing 737-500', 'Boeing', '737 Family', 3, false, 2.4, 'narrowbody', 'B735', 2400, 430, 6000, 145, 110, 3.54, 21.7, 6, 2300, 60550, 39.0, 7200, 40],
  ['b737-700', 'Boeing 737-700', 'Boeing', '737 Family', 3, false, 3.0, 'narrowbody', 'B737', 3010, 453, 6000, 149, 128, 3.54, 24.13, 6, 2200, 70080, 89.0, 15000, 45],
  ['b737-800', 'Boeing 737-800', 'Boeing', '737 Family', 3, false, 4.0, 'narrowbody', 'B738', 2935, 453, 6800, 189, 162, 3.54, 30.0, 6, 2450, 79010, 106.0, 18000, 50],
  ['b737-800bcf', 'Boeing 737-800BCF (Cargo)', 'Boeing', '737 Family', 3, true, 23.9, 'narrowbody', 'B738', 2000, 450, 6800, 0, 0, 3.54, 30.0, 6, 2500, 79010, 68.0, 12000, 50],
  ['b737-max7', 'Boeing 737 MAX 7', 'Boeing', '737 Family', 3, false, 3.2, 'narrowbody', 'B37M', 3800, 453, 6200, 172, 138, 3.54, 26.0, 6, 1950, 80286, 102.0, 17800, 45],
  ['b737-max8', 'Boeing 737 MAX 8', 'Boeing', '737 Family', 3, false, 4.2, 'narrowbody', 'B38M', 3550, 453, 6600, 189, 162, 3.54, 30.0, 6, 2100, 82190, 121.6, 20500, 50],
  ['b737-max8-200', 'Boeing 737 MAX 8-200', 'Boeing', '737 Family', 3, false, 3.8, 'narrowbody', 'B38M', 3000, 453, 6700, 200, 197, 3.54, 30.0, 6, 2100, 82190, 124.0, 21000, 45],
  ['b737-900', 'Boeing 737-900', 'Boeing', '737 Family', 3, false, 4.4, 'narrowbody', 'B739', 2700, 453, 7200, 189, 177, 3.54, 32.66, 6, 2600, 79010, 98.0, 17000, 50],
  ['b737-900er', 'Boeing 737-900ER', 'Boeing', '737 Family', 3, false, 4.5, 'narrowbody', 'B739', 2950, 453, 7200, 220, 178, 3.54, 32.66, 6, 2600, 85130, 112.0, 19200, 50],
  ['b737-max9', 'Boeing 737 MAX 9', 'Boeing', '737 Family', 3, false, 4.6, 'narrowbody', 'B39M', 3300, 453, 7100, 220, 180, 3.54, 32.66, 6, 2250, 88310, 128.9, 22000, 50],
  ['b737-max10', 'Boeing 737 MAX 10', 'Boeing', '737 Family', 3, false, 5.0, 'narrowbody', 'B3XM', 3100, 453, 7500, 230, 192, 3.54, 34.3, 6, 2350, 89765, 134.9, 23200, 55],
  // 757 Family (Tier 3)
  ['b727-200f', 'Boeing 727-200F (Cargo)', 'Boeing', '727 Family', 3, true, 26.0, 'narrowbody', 'B722', 1400, 470, 7400, 0, 0, 3.76, 28.0, 6, 4700, 95000, 18.0, 4200, 55],
  ['b757-200', 'Boeing 757-200', 'Boeing', '757 Family', 3, false, 5.5, 'narrowbody', 'B752', 3915, 460, 7000, 239, 192, 3.54, 36.0, 6, 3200, 115680, 65.0, 11000, 55],
  ['b757-200pcf', 'Boeing 757-200PCF (Cargo)', 'Boeing', '757 Family', 3, true, 36.0, 'narrowbody', 'B752', 3150, 458, 7000, 0, 0, 3.54, 36.0, 6, 3250, 115680, 58.0, 10200, 60],
  ['b757-300', 'Boeing 757-300', 'Boeing', '757 Family', 3, false, 6.2, 'narrowbody', 'B753', 3400, 460, 7800, 295, 243, 3.54, 43.1, 6, 3550, 123600, 76.0, 13200, 60],
  // 767 Family (Tier 4)
  ['b767-200er', 'Boeing 767-200ER', 'Boeing', '767 Family', 4, false, 12.0, 'widebody', 'B762', 6590, 460, 8000, 290, 216, 4.72, 33.9, 7, 4400, 179170, 128.0, 22500, 65],
  ['b767-200f', 'Boeing 767-200F (Cargo)', 'Boeing', '767 Family', 4, true, 45.0, 'widebody', 'B762', 3000, 458, 8000, 0, 0, 4.72, 33.9, 7, 4300, 179170, 60.0, 11500, 70],
  ['b767-300er', 'Boeing 767-300ER', 'Boeing', '767 Family', 4, false, 15.0, 'widebody', 'B763', 5980, 460, 8200, 351, 261, 4.72, 40.4, 7, 4800, 186880, 165.0, 28500, 70],
  ['b767-300f', 'Boeing 767-300F (Cargo)', 'Boeing', '767 Family', 4, true, 52.7, 'widebody', 'B763', 3255, 458, 8200, 0, 0, 4.72, 40.4, 7, 4900, 186880, 185.0, 32000, 75],
  ['b767-400er', 'Boeing 767-400ER', 'Boeing', '767 Family', 4, false, 17.5, 'widebody', 'B764', 5625, 460, 8800, 375, 296, 4.72, 46.8, 7, 5150, 204120, 192.0, 33500, 75],
  // 787 Dreamliner Family (Tier 4)
  ['b787-8', 'Boeing 787-8', 'Boeing', '787 Dreamliner Family', 4, false, 17.0, 'widebody', 'B788', 7355, 488, 8200, 381, 242, 5.49, 42.3, 9, 4600, 227930, 248.3, 44000, 75],
  ['b787-9', 'Boeing 787-9', 'Boeing', '787 Dreamliner Family', 4, false, 20.5, 'widebody', 'B789', 7635, 488, 8500, 420, 290, 5.49, 48.4, 9, 5100, 254011, 292.5, 51000, 80],
  ['b787-10', 'Boeing 787-10', 'Boeing', '787 Dreamliner Family', 4, false, 23.0, 'widebody', 'B78X', 6430, 488, 9100, 440, 330, 5.49, 54.0, 9, 5500, 254011, 338.4, 59000, 85],
  // 777 Family (Tier 4 & Tier 5)
  ['b777-200', 'Boeing 777-200', 'Boeing', '777 Family', 4, false, 20.0, 'widebody', 'B772', 5240, 482, 8000, 440, 313, 5.86, 49.1, 10, 6500, 247200, 200.0, 35500, 80],
  ['b777-200er', 'Boeing 777-200ER', 'Boeing', '777 Family', 4, false, 21.0, 'widebody', 'B772', 7065, 482, 8500, 440, 313, 5.86, 49.1, 10, 6700, 297550, 258.0, 45000, 85],
  ['b777-200lr', 'Boeing 777-200LR', 'Boeing', '777 Family', 4, false, 19.5, 'widebody', 'B77L', 8555, 482, 9200, 440, 301, 5.86, 49.1, 10, 6900, 347450, 315.0, 54500, 90],
  ['b777f', 'Boeing 777F (Cargo)', 'Boeing', '777 Family', 4, true, 102.0, 'widebody', 'B77L', 4970, 480, 9200, 0, 0, 5.86, 49.1, 10, 7000, 347810, 335.0, 58000, 95],
  ['b777-300', 'Boeing 777-300', 'Boeing', '777 Family', 5, false, 24.0, 'heavy_widebody', 'B773', 6005, 482, 9800, 550, 368, 5.86, 59.8, 10, 7600, 299370, 240.0, 42500, 90],
  ['b777-300er', 'Boeing 777-300ER', 'Boeing', '777 Family', 5, false, 26.5, 'heavy_widebody', 'B77W', 7370, 482, 9850, 550, 396, 5.86, 59.8, 10, 7800, 351530, 375.5, 66000, 95],
  ['b777-300ersf', 'Boeing 777-300ERSF (Cargo)', 'Boeing', '777 Family', 5, true, 101.0, 'heavy_widebody', 'B77W', 4650, 482, 9850, 0, 0, 5.86, 59.8, 10, 7700, 351530, 175.0, 31000, 100],
  ['b777-9', 'Boeing 777-9 (777X)', 'Boeing', '777 Family', 5, false, 28.0, 'heavy_widebody', 'B779', 7285, 485, 10000, 475, 426, 5.96, 62.8, 10, 7100, 351500, 442.2, 76500, 95],
  ['b777-8f', 'Boeing 777-8F (Cargo)', 'Boeing', '777 Family', 5, true, 112.3, 'heavy_widebody', 'B778', 4410, 482, 9900, 0, 0, 5.96, 54.9, 10, 6950, 365140, 418.0, 72500, 95],
  // 747 Jumbo Family (Tier 5)
  ['b747-200b', 'Boeing 747-200B', 'Boeing', '747 Jumbo Family', 5, false, 20.0, 'heavy_widebody', 'B742', 6560, 485, 10200, 550, 412, 6.1, 56.5, 10, 11200, 377840, 148.0, 26500, 105],
  ['b747-400', 'Boeing 747-400', 'Boeing', '747 Jumbo Family', 5, false, 22.0, 'heavy_widebody', 'B744', 7260, 493, 9900, 660, 416, 6.1, 57.0, 10, 10200, 396890, 260.0, 46000, 105],
  ['b747-400d', 'Boeing 747-400D', 'Boeing', '747 Jumbo Family', 5, false, 20.0, 'heavy_widebody', 'B744', 1900, 493, 9900, 660, 568, 6.1, 57.0, 10, 9800, 272000, 240.0, 42500, 95],
  ['b747-400f', 'Boeing 747-400F (Cargo)', 'Boeing', '747 Jumbo Family', 5, true, 112.7, 'heavy_widebody', 'B744', 4445, 490, 10000, 0, 0, 6.1, 57.0, 10, 10300, 396890, 255.0, 45000, 110],
  ['b747-8i', 'Boeing 747-8', 'Boeing', '747 Jumbo Family', 5, false, 25.0, 'heavy_widebody', 'B748', 7730, 495, 10200, 605, 467, 6.1, 63.6, 10, 9800, 447700, 418.4, 72000, 110],
  ['b747-8f', 'Boeing 747-8F (Cargo)', 'Boeing', '747 Jumbo Family', 5, true, 137.7, 'heavy_widebody', 'B748', 4120, 492, 10200, 0, 0, 6.1, 63.6, 10, 9950, 447700, 419.2, 72500, 115],

  // ================= EMBRAER =================
  ['emb-110', 'Embraer EMB 110 Bandeirante', 'Embraer', 'EMB 110 / 120 Turboprops', 1, false, 0.3, 'turboprop', 'E110', 1000, 200, 3000, 21, 18, 1.6, 7.5, 3, 250, 5900, 3.0, 800, 15],
  ['emb-120', 'Embraer EMB 120 Brasilia', 'Embraer', 'EMB 110 / 120 Turboprops', 1, false, 0.4, 'turboprop', 'E120', 800, 290, 4500, 30, 30, 2.1, 9.5, 3, 420, 11990, 8.0, 1900, 20],
  ['erj-135', 'Embraer ERJ-135', 'Embraer', 'ERJ Family', 2, false, 0.6, 'regional_jet', 'E135', 1700, 447, 5100, 37, 37, 2.1, 13.0, 3, 980, 20000, 19.0, 3800, 25],
  ['erj-140', 'Embraer ERJ-140', 'Embraer', 'ERJ Family', 2, false, 0.7, 'regional_jet', 'E135', 1650, 447, 5000, 44, 44, 2.1, 14.8, 3, 1030, 21100, 21.0, 4100, 25],
  ['erj-145', 'Embraer ERJ-145', 'Embraer', 'ERJ Family', 2, false, 0.8, 'regional_jet', 'E145', 1550, 447, 4900, 50, 50, 2.1, 16.5, 3, 1080, 22000, 24.0, 4600, 30],
  ['erj-145xr', 'Embraer ERJ-145XR', 'Embraer', 'ERJ Family', 2, false, 0.8, 'regional_jet', 'E45X', 2000, 447, 5400, 50, 50, 2.1, 16.5, 3, 1050, 24100, 26.0, 5000, 30],
  ['e170', 'Embraer E170', 'Embraer', 'E-Jet Family', 2, false, 1.4, 'regional_jet', 'E170', 2150, 447, 4800, 78, 70, 2.74, 18.5, 4, 1400, 38600, 41.0, 7500, 35],
  ['e175', 'Embraer E175', 'Embraer', 'E-Jet Family', 2, false, 1.6, 'regional_jet', 'E175', 2200, 447, 5200, 88, 76, 2.74, 20.2, 4, 1500, 40370, 48.0, 8900, 40],
  ['e175lr', 'Embraer E175LR', 'Embraer', 'E-Jet Family', 2, false, 1.6, 'regional_jet', 'E175', 2250, 447, 5300, 88, 76, 2.74, 20.2, 4, 1500, 40370, 49.0, 9100, 40],
  ['e190', 'Embraer E190', 'Embraer', 'E-Jet Family', 2, false, 2.2, 'regional_jet', 'E190', 2450, 447, 5500, 114, 100, 2.74, 24.5, 4, 1750, 51800, 54.0, 9800, 40],
  ['e190f', 'Embraer E190F (Cargo)', 'Embraer', 'E-Jet Family', 2, true, 13.5, 'regional_jet', 'E190', 2300, 445, 5500, 0, 0, 2.74, 24.5, 4, 1780, 51800, 38.0, 7100, 40],
  ['e195', 'Embraer E195', 'Embraer', 'E-Jet Family', 2, false, 2.4, 'regional_jet', 'E195', 2200, 447, 6000, 124, 116, 2.74, 26.5, 4, 1850, 52290, 58.0, 10400, 45],
  ['e190-e2', 'Embraer E190-E2', 'Embraer', 'E-Jet E2 Family', 2, false, 2.5, 'regional_jet', 'E290', 2850, 470, 5300, 114, 104, 2.74, 24.5, 4, 1550, 56400, 62.0, 11000, 40],
  ['e195-e2', 'Embraer E195-E2', 'Embraer', 'E-Jet E2 Family', 2, false, 2.8, 'regional_jet', 'E295', 2600, 470, 5700, 146, 132, 2.74, 28.1, 4, 1680, 61500, 72.0, 12500, 45],

  // ================= BOMBARDIER =================
  ['crj-200', 'Bombardier CRJ-200', 'Bombardier', 'CRJ Family', 2, false, 0.9, 'regional_jet', 'CRJ2', 1700, 444, 5200, 50, 50, 2.57, 14.8, 4, 1120, 24040, 22.0, 4200, 30],
  ['crj-550', 'Bombardier CRJ-550', 'Bombardier', 'CRJ Family', 2, false, 1.3, 'regional_jet', 'CRJ7', 1400, 447, 5250, 50, 50, 2.57, 18.5, 4, 1350, 34019, 30.0, 5600, 35],
  ['crj-700', 'Bombardier CRJ-700', 'Bombardier', 'CRJ Family', 2, false, 1.4, 'regional_jet', 'CRJ7', 1400, 447, 5250, 78, 70, 2.57, 18.5, 4, 1350, 34019, 38.0, 6900, 35],
  ['crj-705', 'Bombardier CRJ-705', 'Bombardier', 'CRJ Family', 2, false, 1.6, 'regional_jet', 'CRJ9', 1500, 450, 5600, 75, 75, 2.57, 21.1, 4, 1450, 38330, 44.0, 8100, 40],
  ['crj-900', 'Bombardier CRJ-900', 'Bombardier', 'CRJ Family', 2, false, 1.8, 'regional_jet', 'CRJ9', 1550, 450, 5600, 90, 76, 2.57, 21.1, 4, 1450, 38330, 46.0, 8500, 40],
  ['crj-1000', 'Bombardier CRJ-1000', 'Bombardier', 'CRJ Family', 2, false, 2.1, 'regional_jet', 'CRJX', 1650, 450, 5750, 104, 100, 2.57, 23.9, 4, 1560, 41640, 51.0, 9200, 40],

  // ================= ATR =================
  ['atr-42-300f', 'ATR 42-300F (Cargo)', 'ATR', 'ATR 42 / 72 Family', 1, true, 5.0, 'turboprop', 'AT43', 650, 265, 3700, 0, 0, 2.57, 13.85, 4, 620, 16700, 6.0, 1500, 30],
  ['atr-42-500', 'ATR 42-500', 'ATR', 'ATR 42 / 72 Family', 1, false, 0.8, 'turboprop', 'AT45', 700, 300, 3600, 50, 48, 2.57, 13.85, 4, 620, 18600, 12.0, 2600, 30],
  ['atr-42-600', 'ATR 42-600', 'ATR', 'ATR 42 / 72 Family', 1, false, 0.9, 'turboprop', 'AT46', 716, 300, 3445, 50, 48, 2.57, 13.85, 4, 600, 18600, 22.0, 4800, 30],
  ['atr-72-500', 'ATR 72-500', 'ATR', 'ATR 42 / 72 Family', 1, false, 1.3, 'turboprop', 'AT75', 800, 275, 4400, 74, 70, 2.57, 19.21, 4, 800, 22800, 15.0, 3100, 35],
  ['atr-72-500f', 'ATR 72-500F (Cargo)', 'ATR', 'ATR 42 / 72 Family', 1, true, 8.5, 'turboprop', 'AT75', 850, 275, 4400, 0, 0, 2.57, 19.21, 4, 800, 22800, 12.0, 2600, 35],
  ['atr-72-600', 'ATR 72-600', 'ATR', 'ATR 42 / 72 Family', 1, false, 1.4, 'turboprop', 'AT76', 740, 275, 4373, 78, 72, 2.57, 19.21, 4, 780, 23000, 26.0, 5800, 35],
  ['atr-72-600f', 'ATR 72-600F (Cargo)', 'ATR', 'ATR 42 / 72 Family', 1, true, 9.2, 'turboprop', 'AT76', 900, 275, 4373, 0, 0, 2.57, 19.21, 4, 790, 23000, 27.5, 6000, 35],

  // ================= DE HAVILLAND =================
  ['dhc6-400', 'De Havilland Twin Otter Series 400', 'De Havilland', 'Twin Otter STOL Family', 1, false, 0.4, 'turboprop', 'DHC6', 799, 170, 1200, 19, 19, 1.61, 7.2, 3, 270, 5670, 7.5, 1600, 20],
  ['dash8-100', 'De Havilland Dash 8 Q100', 'De Havilland', 'Dash 8 Family', 1, false, 0.8, 'turboprop', 'DH8A', 1020, 270, 3280, 39, 37, 2.51, 11.8, 4, 540, 15650, 16.5, 3500, 25],
  ['dash8-200', 'De Havilland Dash 8 Q200', 'De Havilland', 'Dash 8 Family', 1, false, 0.8, 'turboprop', 'DH8B', 1000, 290, 3280, 40, 37, 2.51, 11.8, 4, 560, 16466, 18.0, 3700, 25],
  ['dash8-300', 'De Havilland Dash 8 Q300', 'De Havilland', 'Dash 8 Family', 1, false, 1.0, 'turboprop', 'DH8C', 930, 285, 3800, 56, 50, 2.51, 15.2, 4, 650, 19500, 21.0, 4300, 30],
  ['dash8-q400', 'De Havilland Dash 8 Q400', 'De Havilland', 'Dash 8 Family', 1, false, 1.5, 'turboprop', 'DH8D', 1100, 360, 4675, 90, 78, 2.51, 18.8, 4, 1050, 29574, 32.0, 6200, 30],
  ['dash8-q400pf', 'De Havilland Dash 8 Q400PF (Cargo)', 'De Havilland', 'Dash 8 Family', 1, true, 9.0, 'turboprop', 'DH8D', 1120, 358, 4675, 0, 0, 2.51, 18.8, 4, 1060, 29574, 33.5, 6500, 35],

  // ================= MCDONNELL DOUGLAS =================
  ['md-82', 'McDonnell Douglas MD-82', 'McDonnell Douglas', 'MD-80 / 90 Family', 3, false, 3.0, 'narrowbody', 'MD82', 2050, 438, 6800, 172, 149, 3.14, 30.8, 5, 3000, 67812, 28.0, 5400, 45],
  ['md-83', 'McDonnell Douglas MD-83', 'McDonnell Douglas', 'MD-80 / 90 Family', 3, false, 3.0, 'narrowbody', 'MD83', 2500, 438, 7000, 172, 149, 3.14, 30.8, 5, 3050, 72575, 30.0, 5700, 45],
  ['md-88', 'McDonnell Douglas MD-88', 'McDonnell Douglas', 'MD-80 / 90 Family', 3, false, 3.0, 'narrowbody', 'MD88', 2050, 438, 6500, 172, 149, 3.14, 30.8, 5, 2950, 67812, 32.0, 6100, 45],
  ['md-90', 'McDonnell Douglas MD-90', 'McDonnell Douglas', 'MD-80 / 90 Family', 3, false, 3.2, 'narrowbody', 'MD90', 2100, 437, 6800, 172, 153, 3.14, 32.0, 5, 2700, 70760, 36.0, 6600, 45],
  ['md-11', 'McDonnell Douglas MD-11', 'McDonnell Douglas', 'MD-11 Trijet Family', 4, false, 18.0, 'widebody', 'MD11', 6725, 473, 9500, 410, 293, 5.69, 46.5, 9, 7200, 273290, 145.0, 26000, 85],
  ['md-11f', 'McDonnell Douglas MD-11F (Cargo)', 'McDonnell Douglas', 'MD-11 Trijet Family', 4, true, 91.7, 'widebody', 'MD11', 3950, 470, 9500, 0, 0, 5.69, 46.5, 9, 7300, 285990, 152.0, 27500, 90],
  ['md-10f', 'McDonnell Douglas MD-10F (Cargo)', 'McDonnell Douglas', 'DC-10 / MD-10 Family', 4, true, 80.0, 'widebody', 'DC10', 3200, 470, 9500, 0, 0, 5.69, 41.0, 9, 7800, 259450, 30.0, 6500, 90],

  // ================= CHINESE JETS (COMAC / AVIC) =================
  ['xian-ma60', 'Xian MA60', 'COMAC / China', 'MA60 Turboprop Family', 1, false, 1.1, 'turboprop', 'MA60', 860, 278, 4250, 60, 56, 2.7, 15.2, 4, 680, 21800, 18.5, 3900, 30],
  ['comac-c909', 'COMAC C909 (ARJ21-700)', 'COMAC / China', 'C909 (ARJ21) Family', 2, false, 1.8, 'regional_jet', 'AJ27', 2000, 447, 5500, 95, 90, 3.14, 20.4, 5, 1650, 43500, 38.0, 7200, 40],
  ['comac-c909ccf', 'COMAC C909CCF (ARJ21 Cargo)', 'COMAC / China', 'C909 (ARJ21) Family', 2, true, 10.2, 'regional_jet', 'AJ27', 1800, 445, 5500, 0, 0, 3.14, 20.4, 5, 1680, 43500, 36.0, 6900, 40],
  ['comac-c919-std', 'COMAC C919-100STD', 'COMAC / China', 'C919 Narrowbody Family', 3, false, 3.8, 'narrowbody', 'C919', 2200, 450, 6500, 192, 158, 3.9, 28.2, 6, 2100, 72500, 95.0, 16500, 45],
  ['comac-c919', 'COMAC C919-100ER', 'COMAC / China', 'C919 Narrowbody Family', 3, false, 3.8, 'narrowbody', 'C919', 3000, 450, 6500, 192, 164, 3.9, 28.2, 6, 2120, 78900, 99.0, 17200, 45],

  // ================= RUSSIAN / CIS JETS =================
  ['an-24rv', 'Antonov An-24RV', 'Russian / CIS', 'An-24 / An-26 Family', 1, false, 0.9, 'turboprop', 'AN24', 1000, 243, 3300, 52, 48, 2.76, 13.5, 4, 820, 21000, 11.0, 2400, 30],
  ['an-26b', 'Antonov An-26B (Cargo)', 'Russian / CIS', 'An-24 / An-26 Family', 1, true, 5.5, 'turboprop', 'AN26', 600, 237, 3600, 0, 0, 2.76, 13.5, 4, 860, 24000, 12.0, 2600, 35],
  ['il-114-300', 'Ilyushin Il-114-300', 'Russian / CIS', 'Il-114 Turboprop Family', 1, false, 1.2, 'turboprop', 'I114', 780, 270, 4300, 68, 64, 2.64, 18.0, 4, 700, 23500, 20.0, 3700, 30],
  ['an-12bk', 'Antonov An-12BK (Cargo)', 'Russian / CIS', 'An-12 Family', 2, true, 20.0, 'turboprop', 'AN12', 1950, 320, 5200, 0, 0, 3.0, 13.5, 4, 2900, 61000, 10.0, 3200, 55],
  ['sj-100', 'Sukhoi Superjet 100', 'Russian / CIS', 'Superjet SJ-100 Family', 2, false, 1.9, 'regional_jet', 'SU95', 2470, 447, 5600, 108, 98, 3.23, 21.2, 5, 1700, 49450, 36.0, 6800, 40],
  ['tu-204-100', 'Tupolev Tu-204-100V', 'Russian / CIS', 'Tu-204 / Tu-214 Family', 3, false, 4.5, 'narrowbody', 'T204', 2800, 458, 6600, 210, 190, 3.57, 33.4, 6, 3150, 105000, 52.0, 9500, 50],
  ['tu-204c', 'Tupolev Tu-204C (Cargo)', 'Russian / CIS', 'Tu-204 / Tu-214 Family', 3, true, 30.0, 'narrowbody', 'T204', 2100, 455, 6600, 0, 0, 3.57, 33.4, 6, 3200, 107500, 49.0, 9000, 55],
  ['tu-214', 'Tupolev Tu-214', 'Russian / CIS', 'Tu-204 / Tu-214 Family', 3, false, 4.8, 'narrowbody', 'T204', 3500, 458, 6800, 210, 194, 3.57, 33.4, 6, 3250, 110750, 58.0, 10500, 50],
  ['mc-21-310', 'Yakovlev MC-21-310', 'Russian / CIS', 'MC-21 Family', 3, false, 4.5, 'narrowbody', 'MC23', 3200, 470, 6900, 211, 180, 4.06, 32.0, 6, 2300, 79250, 90.0, 15500, 50],
  ['il-96-300', 'Ilyushin Il-96-300', 'Russian / CIS', 'Il-96 Quad-Widebody Family', 4, false, 16.0, 'heavy_widebody', 'IL96', 6200, 470, 8600, 300, 262, 5.7, 41.0, 9, 7300, 250000, 115.0, 21000, 80],
  ['il-96-400t', 'Ilyushin Il-96-400T (Cargo)', 'Russian / CIS', 'Il-96 Quad-Widebody Family', 4, true, 92.0, 'heavy_widebody', 'IL96', 2700, 468, 9200, 0, 0, 5.7, 49.5, 9, 7800, 270000, 128.0, 23500, 90],
  ['il-76td-90', 'Ilyushin Il-76TD-90VD (Cargo)', 'Russian / CIS', 'Il-76 / An-124 Outsized Cargo', 5, true, 50.0, 'heavy_widebody', 'IL76', 2700, 445, 9800, 0, 0, 3.45, 24.5, 6, 7500, 195000, 75.0, 14000, 85],
  ['an-124-100', 'Antonov An-124-100 Ruslan (Cargo)', 'Russian / CIS', 'Il-76 / An-124 Outsized Cargo', 5, true, 120.0, 'heavy_widebody', 'A124', 2800, 450, 10200, 0, 0, 6.4, 36.5, 10, 12600, 402000, 165.0, 29500, 115],

  // ================= SAAB =================
  ['saab-340b', 'Saab 340B', 'Saab', 'Saab 340 / 2000 Family', 1, false, 0.5, 'turboprop', 'SF34', 930, 280, 4200, 37, 34, 2.16, 11.0, 3, 400, 13155, 9.0, 2000, 25],
  ['saab-340bf', 'Saab 340BF (Cargo)', 'Saab', 'Saab 340 / 2000 Family', 1, true, 3.7, 'turboprop', 'SF34', 900, 280, 4200, 0, 0, 2.16, 10.4, 3, 400, 13155, 7.0, 1700, 25],
  ['saab-2000', 'Saab 2000', 'Saab', 'Saab 340 / 2000 Family', 1, false, 0.7, 'turboprop', 'SB20', 1500, 368, 4300, 58, 50, 2.16, 14.9, 3, 600, 22800, 14.0, 3000, 30],

  // ================= BRITISH AEROSPACE / AVRO =================
  ['bae146-100', 'BAe 146-100', 'British Aerospace', 'BAe 146 / Avro RJ Family', 2, false, 1.0, 'regional_jet', 'B461', 1630, 420, 4100, 94, 82, 3.42, 19.0, 6, 1550, 38100, 14.0, 3200, 35],
  ['bae146-200', 'BAe 146-200', 'British Aerospace', 'BAe 146 / Avro RJ Family', 2, false, 1.2, 'regional_jet', 'B462', 1600, 420, 4800, 112, 100, 3.42, 21.6, 6, 1650, 42200, 16.0, 3500, 35],
  ['bae146-300', 'BAe 146-300', 'British Aerospace', 'BAe 146 / Avro RJ Family', 2, false, 1.4, 'regional_jet', 'B463', 1550, 420, 5100, 128, 112, 3.42, 24.0, 6, 1750, 44200, 18.0, 3800, 40],
  ['avro-rj70', 'Avro RJ70', 'British Aerospace', 'BAe 146 / Avro RJ Family', 2, false, 1.0, 'regional_jet', 'RJ70', 1650, 410, 4000, 94, 80, 3.42, 19.0, 6, 1500, 40800, 15.0, 3300, 35],
  ['avro-rj85', 'Avro RJ85', 'British Aerospace', 'BAe 146 / Avro RJ Family', 2, false, 1.2, 'regional_jet', 'RJ85', 1600, 410, 4500, 112, 95, 3.42, 21.6, 6, 1600, 43900, 17.0, 3600, 35],
  ['avro-rj100', 'Avro RJ100', 'British Aerospace', 'BAe 146 / Avro RJ Family', 2, false, 1.4, 'regional_jet', 'RJ1H', 1500, 410, 4900, 128, 110, 3.42, 24.0, 6, 1700, 46000, 19.0, 3900, 40],
  ['jetstream-32', 'BAe Jetstream 32', 'British Aerospace', 'Jetstream Family', 1, false, 0.3, 'turboprop', 'JS32', 680, 260, 3600, 19, 19, 1.85, 7.2, 3, 260, 7350, 4.0, 1000, 20],
  ['jetstream-41', 'BAe Jetstream 41', 'British Aerospace', 'Jetstream Family', 1, false, 0.4, 'turboprop', 'JS41', 770, 295, 4200, 30, 29, 1.85, 9.5, 3, 380, 10890, 6.5, 1500, 20],

  // ================= FOKKER =================
  ['fokker-70', 'Fokker 70', 'Fokker', 'Fokker 70 / 100 Family', 2, false, 1.4, 'regional_jet', 'F70', 1840, 440, 4900, 85, 80, 3.1, 21.0, 5, 1650, 41730, 14.0, 3200, 35],
  ['fokker-100', 'Fokker 100', 'Fokker', 'Fokker 70 / 100 Family', 2, false, 1.8, 'regional_jet', 'F100', 1680, 445, 5300, 122, 100, 3.1, 26.0, 5, 1800, 45810, 16.0, 3600, 40],

  // ================= DORNIER =================
  ['do-228ng', 'Dornier 228NG', 'Dornier', 'Dornier 228 / 328 Family', 1, false, 0.4, 'turboprop', 'D228', 600, 223, 2600, 19, 19, 1.35, 9.5, 3, 250, 6575, 7.5, 1600, 15],
  ['do-328-100', 'Dornier 328-100', 'Dornier', 'Dornier 228 / 328 Family', 1, false, 0.6, 'turboprop', 'D328', 900, 335, 3700, 33, 32, 2.16, 10.3, 3, 450, 13990, 10.0, 2200, 25],

  // ================= LOCKHEED =================
  ['l-382g', 'Lockheed L-382G Hercules (Cargo)', 'Lockheed', 'L-100 Hercules Family', 2, true, 23.0, 'turboprop', 'C130', 1300, 300, 5000, 0, 0, 3.1, 17.0, 4, 2300, 70300, 25.0, 5200, 45],

  // ================= SMALL COMMUTER & FEEDER AIRCRAFT =================
  ['c402c', 'Cessna 402C', 'Cessna', 'Cessna Twins & Caravans', 1, false, 0.2, 'turboprop', 'C402', 800, 185, 2200, 9, 9, 1.3, 5.7, 2, 90, 3107, 0.9, 350, 10],
  ['c208b-ex', 'Cessna 208B Grand Caravan EX', 'Cessna', 'Cessna Twins & Caravans', 1, false, 0.3, 'turboprop', 'C208', 900, 185, 2300, 12, 12, 1.6, 5.0, 3, 170, 3995, 2.9, 700, 15],
  ['c208b-cargo', 'Cessna 208B SuperCargomaster (Cargo)', 'Cessna', 'Cessna Twins & Caravans', 1, true, 1.6, 'turboprop', 'C208', 900, 175, 2300, 0, 0, 1.6, 4.6, 3, 170, 3970, 2.5, 620, 15],
  ['c408', 'Cessna 408 SkyCourier (Cargo)', 'Cessna', 'Cessna Twins & Caravans', 1, true, 2.7, 'turboprop', 'C408', 900, 200, 3000, 0, 0, 1.98, 7.0, 3, 260, 8618, 7.0, 1500, 20],
  ['tecnam-p2012', 'Tecnam P2012 Traveller', 'Tecnam', 'P2012 Traveller Family', 1, false, 0.2, 'turboprop', 'P212', 950, 190, 2400, 9, 9, 1.3, 5.7, 2, 85, 3680, 2.4, 500, 10],
  ['bn2-islander', 'Britten-Norman BN-2 Islander', 'Britten-Norman', 'Islander Family', 1, false, 0.2, 'turboprop', 'BN2P', 750, 140, 1500, 9, 9, 1.1, 4.2, 3, 70, 2994, 1.2, 350, 10],
  ['beech-1900d', 'Beechcraft 1900D', 'Beechcraft', 'Beechcraft 1900 Family', 1, false, 0.3, 'turboprop', 'B190', 700, 280, 3800, 19, 19, 1.37, 9.5, 2, 300, 7765, 6.0, 1300, 15],
  ['beech-1900c-cargo', 'Beechcraft 1900C (Cargo)', 'Beechcraft', 'Beechcraft 1900 Family', 1, true, 2.0, 'turboprop', 'B190', 650, 265, 3600, 0, 0, 1.37, 7.8, 2, 290, 7530, 3.0, 800, 15],
  ['pilatus-pc12', 'Pilatus PC-12 NGX', 'Pilatus', 'PC-12 Family', 1, false, 0.2, 'turboprop', 'PC12', 1800, 290, 2500, 9, 8, 1.52, 5.0, 2, 180, 4740, 6.5, 1300, 10],
  ['l-410-uvp', 'Let L-410 UVP-E20', 'Let', 'L-410 Turbolet Family', 1, false, 0.3, 'turboprop', 'L410', 750, 220, 2400, 19, 19, 1.95, 7.2, 3, 240, 6600, 6.0, 1300, 15],
  ['metro-23', 'Fairchild Metro 23', 'Fairchild', 'Metroliner Family', 1, false, 0.3, 'turboprop', 'SW4', 1100, 280, 3800, 19, 19, 1.57, 9.5, 2, 280, 7484, 3.5, 900, 15],
  ['metro-3-cargo', 'Fairchild Metro III (Cargo)', 'Fairchild', 'Metroliner Family', 1, true, 2.0, 'turboprop', 'SW4', 1000, 280, 3800, 0, 0, 1.57, 7.8, 2, 280, 7257, 2.0, 600, 15],
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
  'Saab',
  'British Aerospace',
  'Fokker',
  'Dornier',
  'Lockheed',
  'Cessna',
  'Tecnam',
  'Britten-Norman',
  'Beechcraft',
  'Pilatus',
  'Let',
  'Fairchild',
];
