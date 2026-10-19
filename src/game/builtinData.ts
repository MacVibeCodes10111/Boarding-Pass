// ============================================================================
// BUILT-IN FALLBACK DATA: airports and radio navaids used until the
// OurAirports CSVs in /public/data/ are loaded.
// ============================================================================
import type { Airport, NavaidWaypoint } from './types';

type RawApTuple = [
  string, // 0: iata
  string, // 1: icao
  string, // 2: name
  string, // 3: municipality
  string, // 4: country
  string, // 5: continent
  'large_airport' | 'medium_airport', // 6: type
  number, // 7: lat
  number, // 8: lon
  number, // 9: elev_ft
  number, // 10: rwy_count
  number, // 11: max_rwy_ft
  number  // 12: demand_weight
];

const RAW_BUILTIN_AIRPORTS: RawApTuple[] = [
  // New England & Northeast US (Including Tier 1..5 Coverage)
  ['BOS', 'KBOS', 'General Edward Lawrence Logan Intl', 'Boston', 'US', 'NA', 'large_airport', 42.3643, -71.0052, 20, 6, 10083, 276.6],
  ['BTV', 'KBTV', 'Patrick Leahy Burlington Intl', 'Burlington', 'US', 'NA', 'medium_airport', 44.4719, -73.1533, 335, 2, 8319, 44.2],
  ['MPV', 'KMPV', 'Edward F Knapp State Airport', 'Barre / Montpelier', 'US', 'NA', 'medium_airport', 44.2035, -72.5623, 1165, 2, 5002, 16.0],
  ['RUT', 'KRUT', 'Rutland Southern Vermont Regional', 'Rutland', 'US', 'NA', 'medium_airport', 43.5294, -72.9496, 787, 2, 5000, 15.5],
  ['LEB', 'KLEB', 'Lebanon Municipal Airport', 'Lebanon', 'US', 'NA', 'medium_airport', 43.6261, -72.3042, 603, 2, 5496, 18.2],
  ['MHT', 'KMHT', 'Manchester-Boston Regional', 'Manchester', 'US', 'NA', 'large_airport', 42.9326, -71.4357, 266, 2, 9250, 92.4],
  ['PWM', 'KPWM', 'Portland International Jetport', 'Portland', 'US', 'NA', 'large_airport', 43.6462, -70.3093, 76, 2, 7200, 88.0],
  ['BGR', 'KBGR', 'Bangor International Airport', 'Bangor', 'US', 'NA', 'large_airport', 44.8074, -68.8281, 192, 1, 11440, 68.0],
  ['BHB', 'KBHB', 'Hancock County-Bar Harbor', 'Bar Harbor', 'US', 'NA', 'medium_airport', 44.4498, -68.3616, 83, 2, 5200, 19.0],
  ['RKD', 'KRKD', 'Knox County Regional Airport', 'Rockland', 'US', 'NA', 'medium_airport', 44.0601, -69.0992, 56, 2, 5007, 16.5],
  ['PQI', 'KPQI', 'Presque Isle International', 'Presque Isle', 'US', 'NA', 'medium_airport', 46.689, -68.0448, 534, 2, 7441, 21.0],
  ['AUG', 'KAUG', 'Augusta State Airport', 'Augusta', 'US', 'NA', 'medium_airport', 44.3206, -69.7973, 352, 2, 5001, 15.0],
  ['PSM', 'KPSM', 'Portsmouth International at Pease', 'Portsmouth', 'US', 'NA', 'medium_airport', 43.0779, -70.8233, 100, 1, 11321, 32.0],
  ['PVD', 'KPVD', 'Rhode Island T.F. Green Intl', 'Providence', 'US', 'NA', 'large_airport', 41.724, -71.4282, 55, 2, 8700, 112.0],
  ['BDL', 'KBDL', 'Bradley International Airport', 'Hartford', 'US', 'NA', 'large_airport', 41.9389, -72.6832, 173, 3, 9510, 138.0],
  ['ORH', 'KORH', 'Worcester Regional Airport', 'Worcester', 'US', 'NA', 'medium_airport', 42.2673, -71.8757, 1009, 2, 7001, 28.0],
  ['ACK', 'KACK', 'Nantucket Memorial Airport', 'Nantucket', 'US', 'NA', 'medium_airport', 41.2531, -70.0602, 47, 3, 6303, 34.0],
  ['MVY', 'KMVY', 'Marthas Vineyard Airport', 'Vineyard Haven', 'US', 'NA', 'medium_airport', 41.3931, -70.6143, 67, 2, 5504, 29.0],
  ['HYA', 'KHYA', 'Cape Cod Gateway Airport', 'Hyannis', 'US', 'NA', 'medium_airport', 41.6693, -70.2804, 55, 3, 5425, 24.0],
  ['PVC', 'KPVC', 'Provincetown Municipal Airport', 'Provincetown', 'US', 'NA', 'medium_airport', 42.072, -70.2214, 9, 1, 3502, 14.0],
  ['BID', 'KBID', 'Block Island State Airport', 'Block Island', 'US', 'NA', 'medium_airport', 41.1681, -71.5778, 108, 1, 2502, 12.0],
  ['PBG', 'KPBG', 'Plattsburgh International Airport', 'Plattsburgh', 'US', 'NA', 'medium_airport', 44.6509, -73.4681, 234, 1, 11759, 31.0],
  ['SLK', 'KSLK', 'Adirondack Regional Airport', 'Saranac Lake', 'US', 'NA', 'medium_airport', 44.3853, -74.2062, 1663, 2, 6573, 16.0],
  ['ALB', 'KALB', 'Albany International Airport', 'Albany', 'US', 'NA', 'large_airport', 42.7483, -73.8017, 285, 2, 8500, 96.0],
  ['SYR', 'KSYR', 'Syracuse Hancock International', 'Syracuse', 'US', 'NA', 'large_airport', 43.1112, -76.1063, 421, 2, 9003, 98.0],
  ['ROC', 'KROC', 'Frederick Douglass Greater Rochester', 'Rochester', 'US', 'NA', 'large_airport', 43.1189, -77.6724, 559, 3, 8001, 94.0],
  ['BUF', 'KBUF', 'Buffalo Niagara International', 'Buffalo', 'US', 'NA', 'large_airport', 42.9405, -78.7322, 728, 2, 8829, 118.0],
  // Major US Hubs
  ['JFK', 'KJFK', 'John F Kennedy International', 'New York', 'US', 'NA', 'large_airport', 40.6398, -73.7789, 13, 4, 14511, 328.0],
  ['LGA', 'KLGA', 'LaGuardia Airport', 'New York', 'US', 'NA', 'large_airport', 40.7772, -73.8726, 21, 2, 7003, 210.0],
  ['EWR', 'KEWR', 'Newark Liberty International', 'Newark', 'US', 'NA', 'large_airport', 40.6925, -74.1687, 18, 3, 11000, 265.0],
  ['PHL', 'KPHL', 'Philadelphia International', 'Philadelphia', 'US', 'NA', 'large_airport', 39.8719, -75.2411, 36, 4, 12000, 235.0],
  ['BWI', 'KBWI', 'Baltimore/Washington International', 'Baltimore', 'US', 'NA', 'large_airport', 39.1754, -76.6683, 146, 3, 10502, 215.0],
  ['DCA', 'KDCA', 'Ronald Reagan Washington National', 'Washington', 'US', 'NA', 'large_airport', 38.8521, -77.0377, 15, 3, 7169, 205.0],
  ['IAD', 'KIAD', 'Washington Dulles International', 'Washington', 'US', 'NA', 'large_airport', 38.9445, -77.4558, 312, 4, 11500, 245.0],
  ['ATL', 'KATL', 'Hartsfield-Jackson Atlanta Intl', 'Atlanta', 'US', 'NA', 'large_airport', 33.6367, -84.4281, 1026, 5, 12390, 360.0],
  ['CLT', 'KCLT', 'Charlotte Douglas International', 'Charlotte', 'US', 'NA', 'large_airport', 35.214, -80.9431, 748, 4, 10000, 255.0],
  ['RDU', 'KRDU', 'Raleigh-Durham International', 'Raleigh', 'US', 'NA', 'large_airport', 35.8776, -78.7875, 435, 3, 10000, 155.0],
  ['MIA', 'KMIA', 'Miami International Airport', 'Miami', 'US', 'NA', 'large_airport', 25.7932, -80.2906, 8, 4, 13016, 285.0],
  ['FLL', 'KFLL', 'Fort Lauderdale-Hollywood Intl', 'Fort Lauderdale', 'US', 'NA', 'large_airport', 26.0726, -80.1527, 9, 2, 9000, 210.0],
  ['MCO', 'KMCO', 'Orlando International Airport', 'Orlando', 'US', 'NA', 'large_airport', 28.4294, -81.3089, 96, 4, 12005, 275.0],
  ['TPA', 'KTPA', 'Tampa International Airport', 'Tampa', 'US', 'NA', 'large_airport', 27.9755, -82.5332, 26, 3, 11002, 195.0],
  ['ORD', 'KORD', 'Chicago OHare International', 'Chicago', 'US', 'NA', 'large_airport', 41.9786, -87.9048, 672, 8, 13000, 355.0],
  ['MDW', 'KMDW', 'Chicago Midway International', 'Chicago', 'US', 'NA', 'large_airport', 41.786, -87.7524, 620, 5, 6522, 185.0],
  ['DTW', 'KDTW', 'Detroit Metropolitan Wayne County', 'Detroit', 'US', 'NA', 'large_airport', 42.2124, -83.3534, 645, 6, 12003, 250.0],
  ['MSP', 'KMSP', 'Minneapolis-St Paul International', 'Minneapolis', 'US', 'NA', 'large_airport', 44.882, -93.2218, 841, 4, 11006, 245.0],
  ['STL', 'KSTL', 'St Louis Lambert International', 'St Louis', 'US', 'NA', 'large_airport', 38.7487, -90.37, 618, 4, 11019, 175.0],
  ['MCI', 'KMCI', 'Kansas City International', 'Kansas City', 'US', 'NA', 'large_airport', 39.2976, -94.7139, 1026, 3, 10801, 160.0],
  ['CVG', 'KCVG', 'Cincinnati/Northern Kentucky Intl', 'Cincinnati', 'US', 'NA', 'large_airport', 39.0488, -84.6678, 896, 4, 12000, 170.0],
  ['CLE', 'KCLE', 'Cleveland Hopkins International', 'Cleveland', 'US', 'NA', 'large_airport', 41.4117, -81.8498, 791, 3, 9956, 155.0],
  ['PIT', 'KPIT', 'Pittsburgh International Airport', 'Pittsburgh', 'US', 'NA', 'large_airport', 40.4915, -80.2329, 1203, 4, 11500, 160.0],
  ['IND', 'KIND', 'Indianapolis International', 'Indianapolis', 'US', 'NA', 'large_airport', 39.7173, -86.2944, 797, 3, 11200, 165.0],
  ['BNA', 'KBNA', 'Nashville International Airport', 'Nashville', 'US', 'NA', 'large_airport', 36.1245, -86.6782, 599, 4, 11030, 195.0],
  ['MSY', 'KMSY', 'Louis Armstrong New Orleans Intl', 'New Orleans', 'US', 'NA', 'large_airport', 29.9934, -90.258, 4, 2, 10104, 175.0],
  ['DFW', 'KDFW', 'Dallas Fort Worth International', 'Dallas-Fort Worth', 'US', 'NA', 'large_airport', 32.8968, -97.038, 607, 7, 13401, 350.0],
  ['DAL', 'KDAL', 'Dallas Love Field', 'Dallas', 'US', 'NA', 'large_airport', 32.8471, -96.8518, 487, 2, 8800, 175.0],
  ['IAH', 'KIAH', 'George Bush Intercontinental', 'Houston', 'US', 'NA', 'large_airport', 29.9844, -95.3414, 97, 5, 12001, 290.0],
  ['HOU', 'KHOU', 'William P Hobby Airport', 'Houston', 'US', 'NA', 'large_airport', 29.6454, -95.2789, 46, 3, 7602, 165.0],
  ['AUS', 'KAUS', 'Austin-Bergstrom International', 'Austin', 'US', 'NA', 'large_airport', 30.1945, -97.6699, 542, 2, 12250, 195.0],
  ['DEN', 'KDEN', 'Denver International Airport', 'Denver', 'US', 'NA', 'large_airport', 39.8617, -104.6731, 5431, 6, 16000, 325.0],
  ['SLC', 'KSLC', 'Salt Lake City International', 'Salt Lake City', 'US', 'NA', 'large_airport', 40.7884, -111.9778, 4227, 4, 12002, 225.0],
  ['PHX', 'KPHX', 'Phoenix Sky Harbor International', 'Phoenix', 'US', 'NA', 'large_airport', 33.4343, -112.0116, 1135, 3, 11489, 260.0],
  ['LAS', 'KLAS', 'Harry Reid International Airport', 'Las Vegas', 'US', 'NA', 'large_airport', 36.08, -115.1522, 2181, 4, 14515, 275.0],
  ['LAX', 'KLAX', 'Los Angeles International Airport', 'Los Angeles', 'US', 'NA', 'large_airport', 33.9425, -118.4081, 125, 4, 12923, 345.0],
  ['SAN', 'KSAN', 'San Diego International Airport', 'San Diego', 'US', 'NA', 'large_airport', 32.7336, -117.1897, 17, 1, 9400, 210.0],
  ['SFO', 'KSFO', 'San Francisco International', 'San Francisco', 'US', 'NA', 'large_airport', 37.619, -122.3748, 13, 4, 11870, 305.0],
  ['OAK', 'KOAK', 'San Francisco Bay Oakland Intl', 'Oakland', 'US', 'NA', 'large_airport', 37.7213, -122.2207, 9, 4, 10520, 165.0],
  ['SJC', 'KSJC', 'Norman Y Mineta San Jose Intl', 'San Jose', 'US', 'NA', 'large_airport', 37.3626, -121.929, 62, 2, 11000, 170.0],
  ['PDX', 'KPDX', 'Portland International Airport', 'Portland', 'US', 'NA', 'large_airport', 45.5887, -122.5975, 31, 3, 11000, 200.0],
  ['SEA', 'KSEA', 'Seattle-Tacoma International', 'Seattle', 'US', 'NA', 'large_airport', 47.449, -122.3093, 433, 3, 11901, 275.0],
  ['ANC', 'PANC', 'Ted Stevens Anchorage Intl', 'Anchorage', 'US', 'NA', 'large_airport', 61.1744, -149.9964, 152, 3, 12400, 210.0],
  ['HNL', 'PHNL', 'Daniel K Inouye International', 'Honolulu', 'US', 'NA', 'large_airport', 21.3206, -157.9242, 13, 4, 12312, 240.0],
  // Canada & Latin America
  ['YYZ', 'CYYZ', 'Toronto Pearson International', 'Toronto', 'CA', 'NA', 'large_airport', 43.6772, -79.6306, 569, 5, 11120, 295.0],
  ['YUL', 'CYUL', 'Montreal-Trudeau International', 'Montreal', 'CA', 'NA', 'large_airport', 45.4706, -73.7408, 118, 3, 11000, 225.0],
  ['YVR', 'CYVR', 'Vancouver International Airport', 'Vancouver', 'CA', 'NA', 'large_airport', 49.1939, -123.1844, 14, 3, 11500, 245.0],
  ['YYC', 'CYYC', 'Calgary International Airport', 'Calgary', 'CA', 'NA', 'large_airport', 51.1139, -114.0203, 3557, 4, 14000, 195.0],
  ['MEX', 'MMMX', 'Mexico City International', 'Mexico City', 'MX', 'NA', 'large_airport', 19.4363, -99.0721, 7316, 2, 13000, 285.0],
  ['CUN', 'MMUN', 'Cancun International Airport', 'Cancun', 'MX', 'NA', 'large_airport', 21.0365, -86.8771, 22, 2, 11483, 220.0],
  ['PTY', 'MPTO', 'Tocumen International Airport', 'Panama City', 'PA', 'NA', 'large_airport', 9.0714, -79.3835, 135, 2, 10007, 210.0],
  ['BOG', 'SKBO', 'El Dorado International Airport', 'Bogota', 'CO', 'SA', 'large_airport', 4.7016, -74.1469, 8361, 2, 12467, 250.0],
  ['LIM', 'SPJC', 'Jorge Chavez International', 'Lima', 'PE', 'SA', 'large_airport', -12.0219, -77.1143, 113, 2, 11506, 235.0],
  ['GRU', 'SBGR', 'Sao Paulo-Guarulhos International', 'Sao Paulo', 'BR', 'SA', 'large_airport', -23.4356, -46.4731, 2461, 2, 12139, 290.0],
  ['SCL', 'SCEL', 'Arturo Merino Benitez Intl', 'Santiago', 'CL', 'SA', 'large_airport', -33.393, -70.7858, 1555, 2, 12467, 230.0],
  ['EZE', 'SAEZ', 'Ministro Pistarini International', 'Buenos Aires', 'AR', 'SA', 'large_airport', -34.8222, -58.5358, 67, 2, 10827, 235.0],
  // Europe
  ['LHR', 'EGLL', 'London Heathrow Airport', 'London', 'GB', 'EU', 'large_airport', 51.47, -0.4543, 83, 2, 12799, 360.0],
  ['LGW', 'EGKK', 'London Gatwick Airport', 'London', 'GB', 'EU', 'large_airport', 51.1481, -0.1903, 202, 2, 10879, 240.0],
  ['MAN', 'EGCC', 'Manchester Airport', 'Manchester', 'GB', 'EU', 'large_airport', 53.3537, -2.275, 257, 2, 10000, 215.0],
  ['DUB', 'EIDW', 'Dublin Airport', 'Dublin', 'IE', 'EU', 'large_airport', 53.4213, -6.2701, 242, 2, 10203, 225.0],
  ['KEF', 'BIKF', 'Keflavik International Airport', 'Reykjavik', 'IS', 'EU', 'large_airport', 63.985, -22.6056, 171, 2, 10056, 165.0],
  ['CDG', 'LFPG', 'Charles de Gaulle International', 'Paris', 'FR', 'EU', 'large_airport', 49.0128, 2.55, 392, 4, 13829, 345.0],
  ['NCE', 'LFMN', 'Nice Cote dAzur Airport', 'Nice', 'FR', 'EU', 'large_airport', 43.6584, 7.2159, 12, 2, 9711, 185.0],
  ['AMS', 'EHAM', 'Amsterdam Airport Schiphol', 'Amsterdam', 'NL', 'EU', 'large_airport', 52.3086, 4.7639, -11, 6, 12467, 340.0],
  ['FRA', 'EDDF', 'Frankfurt Airport', 'Frankfurt', 'DE', 'EU', 'large_airport', 50.0333, 8.5706, 364, 4, 13123, 335.0],
  ['MUC', 'EDDM', 'Munich Airport', 'Munich', 'DE', 'EU', 'large_airport', 48.3538, 11.7861, 1487, 2, 13123, 275.0],
  ['ZRH', 'LSZH', 'Zurich Airport', 'Zurich', 'CH', 'EU', 'large_airport', 47.4647, 8.5492, 1416, 3, 12139, 245.0],
  ['MAD', 'LEMD', 'Adolfo Suarez Madrid-Barajas', 'Madrid', 'ES', 'EU', 'large_airport', 40.4719, -3.5626, 1998, 4, 14272, 305.0],
  ['BCN', 'LEBL', 'Josep Tarradellas Barcelona-El Prat', 'Barcelona', 'ES', 'EU', 'large_airport', 41.2971, 2.0785, 12, 3, 11007, 265.0],
  ['LIS', 'LPPT', 'Humberto Delgado Airport', 'Lisbon', 'PT', 'EU', 'large_airport', 38.7813, -9.1359, 374, 2, 12484, 230.0],
  ['FCO', 'LIRF', 'Leonardo da Vinci-Fiumicino', 'Rome', 'IT', 'EU', 'large_airport', 41.8003, 12.2389, 15, 4, 12795, 285.0],
  ['IST', 'LTFM', 'Istanbul Airport', 'Istanbul', 'TR', 'EU', 'large_airport', 41.2753, 28.7519, 325, 5, 13451, 335.0],
  ['SVO', 'UUEE', 'Sheremetyevo International', 'Moscow', 'RU', 'EU', 'large_airport', 55.9726, 37.4146, 622, 3, 12139, 260.0],
  // Middle East, Asia & Oceania
  ['DXB', 'OMDB', 'Dubai International Airport', 'Dubai', 'AE', 'AS', 'large_airport', 25.2528, 55.3644, 62, 2, 14600, 355.0],
  ['DOH', 'OTHH', 'Hamad International Airport', 'Doha', 'QA', 'AS', 'large_airport', 25.2731, 51.6081, 13, 2, 15912, 310.0],
  ['DEL', 'VIDP', 'Indira Gandhi International', 'New Delhi', 'IN', 'AS', 'large_airport', 28.5562, 77.1, 777, 4, 14534, 315.0],
  ['SIN', 'WSSS', 'Singapore Changi Airport', 'Singapore', 'SG', 'AS', 'large_airport', 1.3502, 103.994, 22, 3, 13123, 335.0],
  ['HKG', 'VHHH', 'Hong Kong International Airport', 'Hong Kong', 'HK', 'AS', 'large_airport', 22.3089, 113.9146, 28, 3, 12467, 320.0],
  ['PEK', 'ZBAA', 'Beijing Capital International', 'Beijing', 'CN', 'AS', 'large_airport', 40.0801, 116.5846, 116, 3, 12467, 325.0],
  ['PVG', 'ZSPD', 'Shanghai Pudong International', 'Shanghai', 'CN', 'AS', 'large_airport', 31.1434, 121.8052, 13, 4, 13123, 330.0],
  ['ICN', 'RKSI', 'Incheon International Airport', 'Seoul', 'KR', 'AS', 'large_airport', 37.4691, 126.4505, 23, 4, 13123, 320.0],
  ['HND', 'RJTT', 'Tokyo Haneda International', 'Tokyo', 'JP', 'AS', 'large_airport', 35.5523, 139.7798, 35, 4, 11024, 340.0],
  ['NRT', 'RJAA', 'Narita International Airport', 'Tokyo', 'JP', 'AS', 'large_airport', 35.7647, 140.3864, 141, 2, 13123, 280.0],
  ['SYD', 'YSSY', 'Sydney Kingsford Smith Intl', 'Sydney', 'AU', 'OC', 'large_airport', -33.9461, 151.1772, 21, 3, 12999, 275.0],
];

export const BUILTIN_AIRPORTS: Airport[] = RAW_BUILTIN_AIRPORTS.map((r, idx) => ({
  id: idx + 1,
  iata_code: r[0],
  icao_code: r[1],
  name: r[2],
  municipality: r[3],
  iso_country: r[4],
  country_name: r[4],
  continent: r[5],
  type: r[6],
  latitude_deg: r[7],
  longitude_deg: r[8],
  elevation_ft: r[9],
  runway_count: r[10],
  max_runway_length_ft: r[11],
  demand_weight: r[12],
  hourly_slot_limit: r[10] * (r[6] === 'large_airport' ? 28 : 14),
}));

type RawNavaidTuple = [
  number, // 0: id
  string, // 1: ident
  string, // 2: name
  string, // 3: type
  number, // 4: frequency_khz
  number, // 5: lat
  number, // 6: lon
  string  // 7: associated_airport
];

const RAW_BUILTIN_NAVAIDS: RawNavaidTuple[] = [
  [86260, 'BOS', 'Boston', 'VORTAC', 112700, 42.3574, -70.9895, 'KBOS'],
  [88318, 'GDM', 'Gardner', 'VORTAC', 110600, 42.546, -72.0582, ''],
  [86406, 'BTV', 'Burlington', 'VORTAC', 117500, 44.3971, -73.1826, 'KBTV'],
  [86569, 'CAM', 'Cambridge', 'VOR-DME', 115000, 42.9943, -73.344, ''],
  [86958, 'CON', 'Concord', 'VORTAC', 112900, 43.2198, -71.5755, ''],
  [90947, 'MHT', 'Manchester', 'VOR-DME', 114400, 42.8685, -71.3695, 'KMHT'],
  [85908, 'BDL', 'Bradley', 'VORTAC', 109000, 41.941, -72.6886, 'KBDL'],
  [89475, 'JFK', 'Kennedy', 'VOR-DME', 115900, 40.6329, -73.7714, 'KJFK'],
  [87031, 'CRI', 'Canarsie', 'VOR-DME', 112300, 40.6125, -73.8944, 'KJFK'],
  [90305, 'LGA', 'La Guardia', 'VOR-DME', 113100, 40.7837, -73.8686, 'KLGA'],
  [85664, 'ATL', 'Atlanta', 'VORTAC', 116900, 33.6291, -84.4351, 'KATL'],
  [86863, 'CLT', 'Charlotte', 'VOR-DME', 115000, 35.1903, -80.9517, 'KCLT'],
  [87367, 'DHP', 'Dolphin', 'VORTAC', 113900, 25.8, -80.349, 'KMIA'],
  [91862, 'OBK', 'Northbrook', 'VOR-DME', 113000, 42.2215, -87.9518, 'KORD'],
  [87595, 'DXO', 'Detroit', 'VOR-DME', 113400, 42.2131, -83.3667, 'KDTW'],
  [91290, 'MSP', 'Minneapolis', 'VOR-DME', 115300, 44.8965, -93.2365, 'KMSP'],
  [88343, 'GEP', 'Gopher', 'VORTAC', 117300, 45.1457, -93.3732, ''],
  [87072, 'CSX', 'Cardinal', 'VOR-DME', 116450, 38.7527, -90.3609, 'KSTL'],
  [90795, 'MCI', 'Kansas City', 'VORTAC', 113250, 39.2853, -94.7371, 'KMCI'],
  [85513, 'ANX', 'Napoleon', 'VORTAC', 114000, 39.0954, -94.1288, ''],
  [87336, 'DEN', 'Denver', 'VOR-DME', 117900, 39.8125, -104.661, 'KDEN'],
  [88118, 'FQF', 'Falcon', 'VORTAC', 116300, 39.6901, -104.621, ''],
  [90174, 'LAS', 'Las Vegas', 'VORTAC', 116900, 36.0797, -115.16, 'KLAS'],
  [90184, 'LAX', 'Los Angeles', 'VORTAC', 113600, 33.9331, -118.432, 'KLAX'],
  [91839, 'OAK', 'Oakland', 'VORTAC', 116800, 37.7259, -122.224, 'KOAK'],
  [92248, 'PAE', 'Paine', 'VOR-DME', 110600, 47.9198, -122.278, 'KSEA'],
  [90474, 'LON', 'London', 'VOR-DME', 113600, 51.4872, -0.4667, 'EGLL'],
  [86222, 'BNN', 'Bovingdon', 'VOR-DME', 113750, 51.7261, -0.5497, ''],
  [86050, 'BIG', 'Biggin', 'VOR-DME', 115100, 51.3309, 0.0348, 'EGKB'],
  [85462, 'AMS', 'Amsterdam', 'VOR-DME', 113950, 52.3328, 4.7056, 'EHAM'],
  [87976, 'FFM', 'Frankfurt', 'VORTAC', 114200, 50.0537, 8.6371, 'EDDF'],
];

export const BUILTIN_NAVAIDS: NavaidWaypoint[] = RAW_BUILTIN_NAVAIDS.map((n) => ({
  id: n[0],
  ident: n[1],
  name: n[2],
  type: n[3],
  frequency_khz: n[4],
  latitude_deg: n[5],
  longitude_deg: n[6],
  associated_airport: n[7],
}));
