/**
 * DEMO DATA — loaded only when the server runs with --demo (separate database file).
 * Illustrative records for a Starwiz Green Valley sales demo; dates are relative to today.
 * The production server never imports this module.
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from './index.js';
import { log } from '../logger.js';
import { addDays, financialYear, humanDate, today } from '../utils/dates.js';
import { installmentStatus, syncInstallmentStatuses } from '../services/payments.js';
import { normalizePhone } from '@estateflow/shared';

const T = today();
const D = (n: number) => addDays(T, n);
const DT = (n: number, hm = '11:00') => new Date(`${D(n)}T${hm}:00`).toISOString();
let seed = 20261004;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
const hm = () => `${String(9 + Math.floor(rand() * 10)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`;
const L = (lakh: number) => Math.round(lakh * 100000);

const PROJECT = { location: 'Nigohan–Samesi Road, Mohanlalganj', city: 'Lucknow' };

// ─── Users ───────────────────────────────────────────────────────────────
const USERS = [
  { key: 'admin', name: 'Admin', email: 'admin@demo.com', password: 'Admin@123', role: 'admin', title: 'System Administrator', phone: '+91 94150 10001' },
  { key: 'neha', name: 'Neha Srivastava', email: 'manager@demo.com', password: 'Manager@123', role: 'manager', title: 'Sales Manager', phone: '+91 94150 23871' },
  { key: 'rahul', name: 'Rahul Verma', email: 'sales@demo.com', password: 'Sales@123', role: 'sales', title: 'Senior Sales Executive', phone: '+91 98390 41256' },
  { key: 'priya', name: 'Priya Mishra', email: 'priya@demo.com', password: 'Demo@1234', role: 'sales', title: 'Sales Executive', phone: '+91 70070 58213' },
  { key: 'arjun', name: 'Arjun Yadav', email: 'arjun@demo.com', password: 'Demo@1234', role: 'sales', title: 'Sales Executive', phone: '+91 83180 66402' },
  { key: 'sneha', name: 'Sneha Tripathi', email: 'sneha@demo.com', password: 'Demo@1234', role: 'sales', title: 'Sales Executive', phone: '+91 90050 31877' },
  { key: 'karan', name: 'Karan Awasthi', email: 'karan@demo.com', password: 'Demo@1234', role: 'sales', title: 'Channel Partner Executive', phone: '+91 94500 72914' },
  { key: 'imran', name: 'Imran Qureshi', email: 'imran@demo.com', password: 'Demo@1234', role: 'sales', title: 'Sales Executive', phone: '+91 99350 18420', status: 'Inactive' },
  { key: 'pooja', name: 'Pooja Agarwal', email: 'accounts@demo.com', password: 'Accounts@123', role: 'accounts', title: 'Accounts Manager', phone: '+91 94153 80264' },
  { key: 'manish', name: 'Manish Gupta', email: 'manish@demo.com', password: 'Demo@1234', role: 'accounts', title: 'Accounts Executive', phone: '+91 79050 44318' },
  { key: 'amit', name: 'Amit Sharma', email: 'customer@demo.com', password: 'Customer@123', role: 'customer', title: 'Customer', phone: '+91 98391 22047' },
] as const;
type UserKey = (typeof USERS)[number]['key'];

// ─── Inventory ───────────────────────────────────────────────────────────
const AMENITIES = {
  plots: ['30 & 40 ft internal roads', 'Gated entry with security', 'Street lighting', 'Landscaped parks', 'Underground electricity', 'Water supply line', 'Kids play area'],
  villas: ['Private garden', 'Modular kitchen', 'Covered car parking', 'Clubhouse access', 'Swimming pool', 'Modern gym', '24×7 security', 'Power backup'],
  apartments: ['Lifts with power backup', 'Clubhouse', 'Swimming pool', 'Gymnasium', 'Kids play area', 'Covered parking', 'CCTV surveillance', 'Community hall'],
  commercial: ['High-street frontage', 'Visitor parking', 'Power backup', 'Fire safety systems', 'Restaurant & café zone', '40 ft approach road'],
};
type P = { key: string; project: string; type: string; unit: string; tower?: string; floor?: number; bed?: number; bath?: number; area: number; price: number; status: string; facing?: string; agent: UserKey; name: string; desc: string; parking?: number; furnishing?: string };
const plot = (unit: string, area: number, lakh: number, status: string, facing: string, note: string): P => ({
  key: unit, project: 'Green Valley Plots', type: 'Plot', unit, tower: `Phase 1 · Block ${unit[0]}`, area, price: L(lakh), status, facing, agent: 'arjun',
  name: `${area.toLocaleString('en-IN')} sq ft Residential Plot`, desc: `${note} Freehold residential plot in Phase 1 of Starwiz Green Valley with planned 30 & 40 ft roads and green belts.`,
});
const PROPERTIES: P[] = [
  plot('A-07', 1000, 18.5, 'Sold', 'East', 'Compact east-facing plot close to the main gate.'),
  plot('A-12', 1200, 22.8, 'Sold', 'North', 'North-facing plot on a 30 ft road.'),
  plot('A-18', 1500, 30, 'Booked', 'North-East', 'Corner plot with two open sides.'),
  plot('A-21', 1200, 22.8, 'Booked', 'East', 'East-facing plot opposite the landscaped park.'),
  plot('B-04', 1500, 31.5, 'Booked', 'Park facing', 'Park-facing plot in the quieter inner block.'),
  plot('B-09', 1800, 36, 'Booked', 'North', 'Wide-frontage plot suitable for a duplex home.'),
  plot('B-15', 2000, 42, 'Available', 'East', 'Premium plot on the 40 ft main road.'),
  plot('B-22', 1000, 18.5, 'Available', 'West', 'Value plot, ideal for a first home.'),
  plot('C-03', 2400, 52.8, 'Reserved', 'North-East', 'Large corner plot facing the clubhouse zone.'),
  plot('C-11', 1500, 29.25, 'Booked', 'South', 'Regular plot near the community zone.'),
  plot('C-16', 1800, 35.1, 'Available', 'East', 'East-facing plot beside the green belt.'),
  ...([
    ['V-03', 3, 1950, 85, 'Booked', 'East'],
    ['V-07', 3, 1950, 86.5, 'Booked', 'North'],
    ['V-11', 4, 2600, 118, 'Booked', 'North-East'],
    ['V-14', 4, 2600, 124, 'Available', 'East'],
    ['V-18', 3, 2100, 92, 'Available', 'North'],
    ['V-22', 4, 2850, 145, 'Reserved', 'North-East'],
  ] as const).map(([unit, bed, area, lakh, status, facing]): P => ({
    key: unit, project: 'Green Valley Villas', type: 'Villa', unit, tower: 'Phase 2 · Villa Enclave', bed, bath: bed + 1, area, price: L(lakh), status, facing, agent: 'rahul', parking: 2, furnishing: 'Semi-furnished',
    name: `${bed} BHK Premium Villa`, desc: `G+1 ${bed} BHK villa with private garden, double-height living room and covered parking for two cars. Part of the Phase 2 villa enclave near the clubhouse and pool.`,
  })),
  ...([
    ['A-304', 'Tower A', 3, 2, 1085, 38.5, 'Booked'],
    ['A-702', 'Tower A', 7, 3, 1420, 52, 'Booked'],
    ['A-1201', 'Tower A', 12, 3, 1650, 62, 'Booked'],
    ['B-505', 'Tower B', 5, 2, 1120, 40, 'Available'],
    ['B-1104', 'Tower B', 11, 3, 1480, 56.5, 'Available'],
  ] as const).map(([unit, tower, floor, bed, area, lakh, status]): P => ({
    key: unit + 'R', project: 'Green Valley Residency', type: 'Apartment', unit, tower, floor, bed, bath: bed === 3 ? 3 : 2, area, price: L(lakh), status, facing: floor > 8 ? 'Park view' : 'East', agent: 'sneha', parking: 1, furnishing: 'Unfurnished',
    name: `${bed} BHK${unit === 'A-1201' ? ' + Study' : ''} Apartment`, desc: `${bed} BHK apartment on the ${floor}th floor of ${tower}, Phase 3 residential towers with clubhouse, pool and gym.`,
  })),
  { key: 'S-08', project: 'Green Valley Commercial', type: 'Shop', unit: 'S-08', tower: 'Commercial Zone', floor: 0, area: 320, price: L(28), status: 'Booked', facing: 'Main road', agent: 'karan', name: 'Ground Floor Retail Shop', desc: 'High-street shop facing the township entrance road.' },
  { key: 'S-12', project: 'Green Valley Commercial', type: 'Shop', unit: 'S-12', tower: 'Commercial Zone', floor: 0, area: 410, price: L(35), status: 'Available', facing: 'Main road', agent: 'karan', name: 'Corner Retail Shop', desc: 'Corner shop with double frontage, suited to a pharmacy or convenience store.' },
  { key: 'S-15', project: 'Green Valley Commercial', type: 'Shop', unit: 'S-15', tower: 'Commercial Zone', floor: 0, area: 280, price: L(24.5), status: 'Sold', facing: 'Internal', agent: 'karan', name: 'Retail Shop', desc: 'Compact shop in the daily-needs arcade.' },
  { key: 'O-201', project: 'Green Valley Commercial', type: 'Office', unit: 'O-201', tower: 'Commercial Zone', floor: 2, area: 850, price: L(48), status: 'Available', facing: 'East', agent: 'karan', parking: 1, name: 'Office Space', desc: 'Open-plan office on the second floor with lift access.' },
  { key: 'O-204', project: 'Green Valley Commercial', type: 'Office', unit: 'O-204', tower: 'Commercial Zone', floor: 2, area: 1100, price: L(58), status: 'Reserved', facing: 'North', agent: 'karan', parking: 2, name: 'Corner Office Space', desc: 'Corner office with natural light on two sides.' },
  { key: 'CM-01', project: 'Green Valley Commercial', type: 'Commercial', unit: 'CM-01', tower: 'Food & Lifestyle Zone', floor: 0, area: 2400, price: L(135), status: 'Available', facing: 'Main road', agent: 'priya', parking: 6, name: 'Restaurant / Showroom Space', desc: 'Double-height space planned for a restaurant, café or showroom in the food & lifestyle zone.' },
];
const AMENITY_FOR: Record<string, string[]> = {
  'Green Valley Plots': AMENITIES.plots,
  'Green Valley Villas': AMENITIES.villas,
  'Green Valley Residency': AMENITIES.apartments,
  'Green Valley Commercial': AMENITIES.commercial,
};
const STAGE_FOR: Record<string, string> = {
  'Green Valley Plots': 'Ready for possession',
  'Green Valley Villas': 'Structure',
  'Green Valley Residency': 'Foundation',
  'Green Valley Commercial': 'Finishing',
};
const POSSESSION: Record<string, string> = {
  'Green Valley Plots': 'Ready for registry',
  'Green Valley Villas': 'Dec 2027',
  'Green Valley Residency': 'Mar 2028',
  'Green Valley Commercial': 'Jun 2027',
};

// ─── Customers (each converted from a lead) ──────────────────────────────
type Inst = [label: string, dueOffset: number, lakh: number];
type Pay = [instNo: number, lakh: number, method: string, dayOffset: number, ref: string, status?: 'Completed' | 'Pending' | 'Failed'];
interface Cust {
  name: string; phone: string; email: string; prop: string; agent: UserKey; source: string; booked: number; value: number;
  city: string; address: string; occupation: string; pan: string; aadhaar: string; plan: Inst[]; pays: Pay[]; stage?: string;
}
const VILLA_PLAN = ['Booking Amount', 'On Agreement', 'On Foundation', 'On Plinth', 'On Ground Floor Slab', 'On First Floor Slab', 'On Brickwork', 'On Finishing', 'On Possession'];
const next15 = (months: number) => {
  const d = new Date(`${T}T00:00:00`);
  const x = new Date(d.getFullYear(), d.getMonth() + months, 15);
  return Math.round((x.getTime() - d.getTime()) / 86400000);
};
const CUSTOMERS: Cust[] = [
  {
    name: 'Amit Sharma', phone: '+91 98391 22047', email: 'customer@demo.com', prop: 'V-03', agent: 'rahul', source: 'Website', booked: -160, value: L(85),
    city: 'Lucknow', address: '2/114, Vipul Khand, Gomti Nagar, Lucknow 226010', occupation: 'Senior Manager, HCL Technologies', pan: 'BQXPS4821K', aadhaar: 'XXXX XXXX 4417',
    plan: [[VILLA_PLAN[0], -160, 10], [VILLA_PLAN[1], -130, 7.5], [VILLA_PLAN[2], -20, 7.5], [VILLA_PLAN[3], next15(1), 5], [VILLA_PLAN[4], next15(3), 5], [VILLA_PLAN[5], next15(5), 5], [VILLA_PLAN[6], next15(7), 5], [VILLA_PLAN[7], next15(10), 10], [VILLA_PLAN[8], next15(14), 30]],
    pays: [[1, 10, 'Bank Transfer', -160, 'RTGS/HDFC/R4520931'], [2, 7.5, 'Cheque', -131, 'CHQ 004512 · HDFC Bank'], [3, 5, 'Bank Transfer', -24, 'NEFT/ICIC/N2681204'], [3, 2.5, 'Bank Transfer', -3, 'NEFT/ICIC/N2719836']],
    stage: 'Agreement Signed',
  },
  {
    name: 'Rohit Srivastava', phone: '+91 94151 66320', email: 'rohit.srivastava@gmail.com', prop: 'V-07', agent: 'priya', source: 'Referral', booked: -95, value: L(84),
    city: 'Lucknow', address: 'C-2/45, Sector C, Aliganj, Lucknow 226024', occupation: 'Owner, Srivastava Pharma Distributors', pan: 'AJMPS7710E', aadhaar: 'XXXX XXXX 9021',
    plan: [[VILLA_PLAN[0], -95, 10], [VILLA_PLAN[1], -62, 7], [VILLA_PLAN[2], -12, 7], [VILLA_PLAN[3], 48, 7], [VILLA_PLAN[4], 108, 7], [VILLA_PLAN[5], 168, 7], [VILLA_PLAN[7], 260, 9], [VILLA_PLAN[8], 420, 30]],
    pays: [[1, 10, 'Bank Transfer', -95, 'RTGS/SBIN/R5520931'], [2, 7, 'Cheque', -60, 'CHQ 118204 · Bank of Baroda']],
    stage: 'Agreement Signed',
  },
  {
    name: 'Alok Dwivedi', phone: '+91 98380 51734', email: 'alok.dwivedi@outlook.com', prop: 'V-11', agent: 'rahul', source: 'Google', booked: -40, value: L(115),
    city: 'Lucknow', address: 'B-1/203, Sushant Golf City, Lucknow 226030', occupation: 'Consultant Cardiologist', pan: 'AHFPD3052L', aadhaar: 'XXXX XXXX 7735',
    plan: [[VILLA_PLAN[0], -40, 12], [VILLA_PLAN[1], -10, 11.5], [VILLA_PLAN[2], 50, 11.5], [VILLA_PLAN[3], 110, 11.5], [VILLA_PLAN[4], 170, 11.5], [VILLA_PLAN[6], 260, 12], [VILLA_PLAN[8], 430, 45]],
    pays: [[1, 12, 'Bank Transfer', -40, 'RTGS/PUNB/R7713026'], [2, 6, 'Cheque', -9, 'CHQ 552019 · Axis Bank']],
  },
  {
    name: 'Saurabh Tripathi', phone: '+91 70071 93418', email: 'saurabh.tripathi@yahoo.in', prop: 'A-18', agent: 'arjun', source: 'Facebook', booked: -210, value: L(30),
    city: 'Lucknow', address: '554/12, Alambagh, Lucknow 226005', occupation: 'Branch Manager, Bank of India', pan: 'BDKPT9014A', aadhaar: 'XXXX XXXX 3346',
    plan: [['Booking Amount', -210, 5], ['Installment 1', -150, 8], ['Installment 2', -60, 8], ['Final — On Registry', 30, 9]],
    pays: [[1, 5, 'Cheque', -210, 'CHQ 330871 · Bank of India'], [2, 8, 'Bank Transfer', -148, 'NEFT/BKID/N1180356'], [3, 8, 'Bank Transfer', -61, 'NEFT/BKID/N2207714']],
  },
  {
    name: 'Anjali Mishra', phone: '+91 83180 27756', email: 'anjali.mishra@gmail.com', prop: 'A-21', agent: 'sneha', source: 'Instagram', booked: -120, value: L(22.8),
    city: 'Lucknow', address: '3/219, Vikas Nagar, Lucknow 226022', occupation: 'Assistant Professor, Lucknow University', pan: 'CFRPM2290H', aadhaar: 'XXXX XXXX 6152',
    plan: [['Booking Amount', -120, 3], ['Installment 1', -60, 6.6], ['Installment 2', 1, 6.6], ['Final — On Registry', 70, 6.6]],
    pays: [[1, 3, 'Bank Transfer', -120, 'IMPS/UBIN/417220931'], [2, 6.6, 'Bank Transfer', -59, 'NEFT/UBIN/N2014418']],
  },
  {
    name: 'Vivek Pandey', phone: '+91 94155 30871', email: 'vivek.pandey@rediffmail.com', prop: 'B-04', agent: 'rahul', source: 'Broker', booked: -75, value: L(31.5),
    city: 'Kanpur', address: '117/H-1/44, Pandu Nagar, Kanpur 208005', occupation: 'Proprietor, Pandey Hardware & Paints', pan: 'AKVPP6627M', aadhaar: 'XXXX XXXX 8803',
    plan: [['Booking Amount', -75, 5], ['Installment 1', -15, 13.25], ['Final — On Registry', 75, 13.25]],
    pays: [[1, 5, 'Cheque', -75, 'CHQ 006213 · Canara Bank'], [2, 13.25, 'Cheque', -2, 'CHQ 006247 · Canara Bank', 'Pending']],
  },
  {
    name: 'Shalini Singh', phone: '+91 99366 41029', email: 'shalini.singh@gmail.com', prop: 'B-09', agent: 'karan', source: 'Walk-in', booked: -26, value: L(36),
    city: 'Lucknow', address: '18, Mall Avenue, Hazratganj, Lucknow 226001', occupation: 'Architect, Singh & Associates', pan: 'DLSPS5181Q', aadhaar: 'XXXX XXXX 2290',
    plan: [['Booking Amount', -26, 5], ['Installment 1', 15, 7.75], ['Installment 2', 75, 7.75], ['Installment 3', 135, 7.75], ['Final — On Registry', 195, 7.75]],
    pays: [[1, 0.5, 'Card', -26, 'POS/HDFC/882041'], [1, 4.5, 'Bank Transfer', -25, 'NEFT/HDFC/N2559013']],
  },
  {
    name: 'Rajesh Gupta', phone: '+91 79055 12684', email: 'rajesh.gupta@gmail.com', prop: 'C-11', agent: 'priya', source: 'Referral', booked: -8, value: L(29.25),
    city: 'Lucknow', address: '9/7, Sector 9, Indira Nagar, Lucknow 226016', occupation: 'Chartered Accountant', pan: 'AAOPG4731C', aadhaar: 'XXXX XXXX 5568',
    plan: [['Booking Amount', -8, 3], ['Installment 1', 52, 8.75], ['Installment 2', 112, 8.75], ['Final — On Registry', 172, 8.75]],
    pays: [[1, 1, 'UPI', -8, 'UPI/6245 1187 2093'], [1, 2, 'Bank Transfer', -7, 'NEFT/SBIN/N2766120']],
  },
  {
    name: 'Neha Agarwal', phone: '+91 94508 77310', email: 'neha.agarwal@icloud.com', prop: 'A-304R', agent: 'sneha', source: 'Website', booked: -180, value: L(38.5),
    city: 'Lucknow', address: 'Flat 504, Eldeco Elegance, Vibhuti Khand, Gomti Nagar, Lucknow 226010', occupation: 'Software Engineer, TCS', pan: 'BWEPA8813D', aadhaar: 'XXXX XXXX 1184',
    plan: [['Booking Amount', -180, 4], ['Installment 1', -140, 7], ['Installment 2', -80, 7], ['Installment 3', -20, 7], ['Installment 4', 40, 6.75], ['Final — On Possession', 100, 6.75]],
    pays: [[1, 4, 'Bank Transfer', -180, 'NEFT/HDFC/N1022873'], [2, 7, 'Finance', -138, 'SBI Home Loan · HL/2026/77812'], [3, 7, 'Finance', -79, 'SBI Home Loan · HL/2026/77812'], [4, 7, 'Finance', -21, 'SBI Home Loan · HL/2026/77812']],
  },
  {
    name: 'Ankit Yadav', phone: '+91 81272 90455', email: 'ankit.yadav@gmail.com', prop: 'A-702R', agent: 'arjun', source: 'Google', booked: -130, value: L(52),
    city: 'Lucknow', address: 'LDA Colony, Sector D-1, Kanpur Road, Lucknow 226012', occupation: 'Sub-Inspector, UP Police', pan: 'CNHPY2045R', aadhaar: 'XXXX XXXX 9947',
    plan: [['Booking Amount', -130, 5], ['Installment 1', -100, 9.4], ['Installment 2', -40, 9.4], ['Installment 3', 20, 9.4], ['Installment 4', 80, 9.4], ['Final — On Possession', 140, 9.4]],
    pays: [[1, 5, 'Bank Transfer', -130, 'IMPS/PUNB/412890034'], [2, 9.4, 'Finance', -99, 'PNB Housing · PHFL/LKO/20931'], [3, 4, 'Bank Transfer', -36, 'NEFT/PUNB/N2318840']],
  },
  {
    name: 'Mohd. Faisal Khan', phone: '+91 98896 34120', email: 'faisal.khan@gmail.com', prop: 'A-1201R', agent: 'rahul', source: 'Instagram', booked: -62, value: L(60.5),
    city: 'Lucknow', address: '27, Nishatganj, Lucknow 226006', occupation: 'Director, Khan Exports Pvt. Ltd.', pan: 'ATQPK6390B', aadhaar: 'XXXX XXXX 0476',
    plan: [['Booking Amount', -62, 6], ['Installment 1', -32, 13.5], ['Installment 2', 35, 13.5], ['Installment 3', 95, 13.5], ['Final — On Possession', 155, 14]],
    pays: [[1, 6, 'Bank Transfer', -62, 'RTGS/ICIC/R6630127'], [2, 13.5, 'Bank Transfer', -33, 'RTGS/ICIC/R6719284']],
  },
  {
    name: 'Priyanka Shukla', phone: '+91 70078 51936', email: 'priyanka.shukla@gmail.com', prop: 'S-08', agent: 'karan', source: 'Broker', booked: -100, value: L(28),
    city: 'Lucknow', address: '1/88, Telibagh, Raebareli Road, Lucknow 226025', occupation: 'Owner, Shukla Boutique', pan: 'EGKPS7342N', aadhaar: 'XXXX XXXX 3651',
    plan: [['Booking Amount', -100, 4], ['Installment 1', -70, 8], ['Installment 2', -10, 8], ['Final — On Possession', 50, 8]],
    pays: [[1, 4, 'Cheque', -100, 'CHQ 201554 · Indian Bank'], [2, 8, 'Bank Transfer', -69, 'NEFT/IDIB/N1874425'], [3, 8, 'Cheque', -9, 'CHQ 201571 · Indian Bank', 'Failed']],
  },
  {
    name: 'Abhishek Tiwari', phone: '+91 94152 08853', email: 'abhishek.tiwari@gmail.com', prop: 'A-07', agent: 'priya', source: 'Walk-in', booked: -330, value: L(18.5),
    city: 'Lucknow', address: '45, Jankipuram Extension, Lucknow 226031', occupation: 'Government Teacher', pan: 'AZTPT1198G', aadhaar: 'XXXX XXXX 7124',
    plan: [['Booking Amount', -330, 3], ['Installment 1', -270, 5.15], ['Installment 2', -210, 5.15], ['Final — On Registry', -150, 5.2]],
    pays: [[1, 3, 'Cheque', -330, 'CHQ 774410 · SBI'], [2, 5.15, 'Bank Transfer', -268, 'NEFT/SBIN/N0510093'], [3, 5.15, 'Bank Transfer', -211, 'NEFT/SBIN/N0791155'], [4, 5.2, 'Bank Transfer', -149, 'NEFT/SBIN/N1066802']],
    stage: 'Registration',
  },
  {
    name: 'Gaurav Rastogi', phone: '+91 99190 47722', email: 'gaurav.rastogi@gmail.com', prop: 'A-12', agent: 'arjun', source: 'Referral', booked: -300, value: L(22.8),
    city: 'Lucknow', address: 'B-220, Rajajipuram, Lucknow 226017', occupation: 'Owner, Rastogi Jewellers', pan: 'AFKPR8865J', aadhaar: 'XXXX XXXX 6630',
    plan: [['Booking Amount', -300, 4], ['Installment 1', -240, 6.25], ['Installment 2', -180, 6.25], ['Final — On Registry', -120, 6.3]],
    pays: [[1, 4, 'Bank Transfer', -300, 'RTGS/UTIB/R0388120'], [2, 6.25, 'Cheque', -238, 'CHQ 090117 · Axis Bank'], [3, 6.25, 'Bank Transfer', -181, 'NEFT/UTIB/N0920334'], [4, 6.3, 'Bank Transfer', -118, 'NEFT/UTIB/N1240091']],
    stage: 'Registration',
  },
  {
    name: 'Sana Siddiqui', phone: '+91 83035 66219', email: 'sana.siddiqui@gmail.com', prop: 'S-15', agent: 'sneha', source: 'Facebook', booked: -260, value: L(24.5),
    city: 'Lucknow', address: '12/3, Aminabad, Lucknow 226018', occupation: 'Owner, Siddiqui Opticals', pan: 'BOWPS3374F', aadhaar: 'XXXX XXXX 2058',
    plan: [['Booking Amount', -260, 4.5], ['Installment 1', -200, 10], ['Final — On Possession', -140, 10]],
    pays: [[1, 4.5, 'Cheque', -260, 'CHQ 410236 · HDFC Bank'], [2, 10, 'Bank Transfer', -199, 'RTGS/HDFC/R0720046'], [3, 10, 'Bank Transfer', -139, 'RTGS/HDFC/R1031558']],
    stage: 'Registration',
  },
];

// ─── Open leads ──────────────────────────────────────────────────────────
interface LeadSeed {
  name: string; phone: string; email?: string; loc: string; source: string; status: string; priority: string; agent: UserKey | null;
  prop?: string; type: string; budget: number; created: number; req: string; lost?: string;
}
const LEADS: LeadSeed[] = [
  // New
  { name: 'Vikas Chaudhary', phone: '+91 90443 18275', email: 'vikas.chaudhary@gmail.com', loc: 'Chinhat, Lucknow', source: 'Website', status: 'New', priority: 'Warm', agent: 'arjun', prop: 'B-22', type: 'Plot', budget: L(20), created: -1, req: 'Enquired through the website for a 1000 sq ft plot. Wants the price list and payment plan on WhatsApp.' },
  { name: 'Sakshi Nigam', phone: '+91 73880 52190', email: 'sakshi.nigam@gmail.com', loc: 'Aashiana, Lucknow', source: 'Instagram', status: 'New', priority: 'Warm', agent: null, prop: 'B-505R', type: 'Apartment', budget: L(40), created: 0, req: 'Responded to the Instagram reel on Green Valley Residency. Looking for a 2 BHK for her parents.' },
  { name: 'Prateek Malviya', phone: '+91 95655 20937', loc: 'Rajajipuram, Lucknow', source: 'Google', status: 'New', priority: 'Cold', agent: null, type: 'Plot', budget: L(35), created: -2, req: 'Searched for plots near Mohanlalganj. Investment purchase, flexible on size.' },
  { name: 'Ayesha Naqvi', phone: '+971 50 418 2273', email: 'ayesha.naqvi@gmail.com', loc: 'Dubai, UAE (NRI)', source: 'Facebook', status: 'New', priority: 'Hot', agent: 'rahul', prop: 'V-18', type: 'Villa', budget: L(95), created: -3, req: 'NRI buyer relocating to Lucknow next year. Wants a 3 BHK villa near the clubhouse; prefers a video walkthrough.' },
  { name: 'Yogesh Rawat', phone: '+91 88400 61745', loc: 'Mohanlalganj, Lucknow', source: 'Walk-in', status: 'New', priority: 'Warm', agent: 'karan', prop: 'S-12', type: 'Shop', budget: L(32), created: -4, req: 'Walked into the site office. Runs a medical store in Samesi and wants a shop in the commercial zone.' },
  { name: 'Divya Sinha', phone: '+91 97928 33016', email: 'divya.sinha@outlook.com', loc: 'Gomti Nagar Extension, Lucknow', source: 'Website', status: 'New', priority: 'Warm', agent: 'sneha', prop: 'B-1104R', type: 'Apartment', budget: L(55), created: -5, req: 'Downloaded the Residency brochure. Interested in a 3 BHK on a higher floor.' },
  // Contacted
  { name: 'Manoj Chaurasia', phone: '+91 94153 77208', loc: 'Nigohan, Lucknow', source: 'Referral', status: 'Contacted', priority: 'Warm', agent: 'arjun', prop: 'C-16', type: 'Plot', budget: L(32), created: -9, req: 'Referred by Saurabh Tripathi. Local businessman looking for an east-facing plot to build his family home.' },
  { name: 'Ritu Saxena', phone: '+91 70806 44519', email: 'ritu.saxena@gmail.com', loc: 'Mahanagar, Lucknow', source: 'Facebook', status: 'Contacted', priority: 'Cold', agent: 'sneha', prop: 'B-505R', type: 'Apartment', budget: L(38), created: -12, req: 'Interested in a 2 BHK but evaluating projects closer to the city. Asked for loan tie-up details.' },
  { name: 'Arvind Maurya', phone: '+91 98385 10264', loc: 'Barabanki', source: 'Broker', status: 'Contacted', priority: 'Warm', agent: 'karan', prop: 'B-15', type: 'Plot', budget: L(45), created: -14, req: 'Sourced by channel partner Lucknow Homes. Wants a 2000 sq ft plot on the 40 ft road.' },
  { name: 'Deepika Kushwaha', phone: '+91 91402 87736', email: 'deepika.k@gmail.com', loc: 'Indira Nagar, Lucknow', source: 'Google', status: 'Contacted', priority: 'Warm', agent: 'rahul', prop: 'V-14', type: 'Villa', budget: L(110), created: -16, req: 'Doctor couple looking for a 4 BHK villa. Want to understand the construction timeline.' },
  { name: 'Harsh Vardhan Singh', phone: '+91 94157 64410', email: 'harsh.vsingh@gmail.com', loc: 'Hazratganj, Lucknow', source: 'Website', status: 'Contacted', priority: 'Hot', agent: 'rahul', prop: 'V-22', type: 'Villa', budget: L(140), created: -18, req: 'Looking at the signature villa. Interested in a customised interior package.' },
  { name: 'Nidhi Upadhyay', phone: '+91 80045 92318', loc: 'Vrindavan Yojana, Lucknow', source: 'Instagram', status: 'Contacted', priority: 'Warm', agent: 'priya', prop: 'B-1104R', type: 'Apartment', budget: L(54), created: -20, req: 'Wants a 3 BHK with a park view. Will visit with her husband on a weekend.' },
  // Qualified
  { name: 'Tanvi Mehrotra', phone: '+91 99560 21847', email: 'tanvi.mehrotra@gmail.com', loc: 'Aliganj, Lucknow', source: 'Referral', status: 'Qualified', priority: 'Hot', agent: 'priya', prop: 'V-18', type: 'Villa', budget: L(92), created: -24, req: 'Referred by Rohit Srivastava. Budget approved, home loan pre-sanctioned with HDFC.' },
  { name: 'Kunal Bhatia', phone: '+91 97211 40683', email: 'kunal@bhatiaassociates.in', loc: 'Kanpur Road, Lucknow', source: 'Google', status: 'Qualified', priority: 'Warm', agent: 'karan', prop: 'O-201', type: 'Office', budget: L(50), created: -27, req: 'CA firm planning a second office near the township. Needs 800–900 sq ft with parking.' },
  { name: 'Rashmi Pathak', phone: '+91 94508 33162', loc: 'Telibagh, Lucknow', source: 'Website', status: 'Qualified', priority: 'Warm', agent: 'arjun', prop: 'C-03', type: 'Plot', budget: L(50), created: -30, req: 'Wants a large corner plot for a joint family home. Comparing with a plot on Sultanpur Road.' },
  { name: 'Sandeep Jaiswal', phone: '+91 98391 70254', email: 'sandeep@jaiswalfoods.com', loc: 'Charbagh, Lucknow', source: 'Broker', status: 'Qualified', priority: 'Hot', agent: 'priya', prop: 'CM-01', type: 'Commercial', budget: L(135), created: -33, req: 'Restaurant chain owner evaluating the food & lifestyle zone for a family restaurant.' },
  { name: 'Aman Rizvi', phone: '+91 88878 25190', loc: 'Daliganj, Lucknow', source: 'Facebook', status: 'Qualified', priority: 'Warm', agent: 'rahul', prop: 'B-15', type: 'Plot', budget: L(42), created: -36, req: 'Wants a main-road plot for future resale. Asked about appreciation in the last two years.' },
  // Site Visit
  { name: 'Megha Kapoor', phone: '+91 99350 60218', email: 'megha.kapoor@gmail.com', loc: 'Gomti Nagar, Lucknow', source: 'Website', status: 'Site Visit', priority: 'Hot', agent: 'rahul', prop: 'V-14', type: 'Villa', budget: L(125), created: -22, req: 'Visiting with family this afternoon. Interested in the 4 BHK east-facing villa.' },
  { name: 'Nitin Awasthi', phone: '+91 73550 18843', loc: 'Sarojini Nagar, Lucknow', source: 'Referral', status: 'Site Visit', priority: 'Warm', agent: 'arjun', prop: 'B-15', type: 'Plot', budget: L(42), created: -29, req: 'Liked the 40 ft road plots. Wants to check registry charges and the approval status.' },
  { name: 'Shweta Bajpai', phone: '+91 96285 44107', email: 'shweta.bajpai@gmail.com', loc: 'Jankipuram, Lucknow', source: 'Instagram', status: 'Site Visit', priority: 'Warm', agent: 'sneha', prop: 'B-1104R', type: 'Apartment', budget: L(57), created: -34, req: 'Completed the sample-flat visit. Asked for a floor plan with furniture layout.' },
  { name: 'Farhan Abbasi', phone: '+91 95060 31268', loc: 'Samesi, Lucknow', source: 'Walk-in', status: 'Site Visit', priority: 'Warm', agent: 'karan', prop: 'S-12', type: 'Shop', budget: L(35), created: -38, req: 'Wants a corner shop for a mobile accessories store. Negotiating on the floor rise charges.' },
  { name: 'Rekha Chauhan', phone: '+91 80900 73314', email: 'rekha.chauhan@gmail.com', loc: 'Alambagh, Lucknow', source: 'Google', status: 'Site Visit', priority: 'Warm', agent: 'priya', prop: 'V-18', type: 'Villa', budget: L(90), created: -41, req: 'Visited the villa enclave with her son. Wants to see the clubhouse progress.' },
  // Negotiation
  { name: 'Dr. Anupam Shukla', phone: '+91 94150 88216', email: 'dr.anupam.shukla@gmail.com', loc: 'Vibhuti Khand, Gomti Nagar, Lucknow', source: 'Referral', status: 'Negotiation', priority: 'Hot', agent: 'rahul', prop: 'V-22', type: 'Villa', budget: L(145), created: -46, req: 'Senior orthopaedic surgeon looking for the signature 4 BHK corner villa. Wants a Vastu-compliant entrance and a home-office room. Ready to book once the payment plan is finalised.' },
  { name: 'Swati Kesarwani', phone: '+91 70072 64490', loc: 'Aishbagh, Lucknow', source: 'Website', status: 'Negotiation', priority: 'Warm', agent: 'sneha', prop: 'B-505R', type: 'Apartment', budget: L(39), created: -44, req: 'Asking for a waiver on parking charges. Home loan file in process with LIC HFL.' },
  { name: 'Devendra Pal', phone: '+91 98074 51327', email: 'devendra.pal@palinfra.in', loc: 'Transport Nagar, Lucknow', source: 'Broker', status: 'Negotiation', priority: 'Hot', agent: 'karan', prop: 'O-204', type: 'Office', budget: L(56), created: -50, req: 'Infrastructure contractor wants the corner office for a site office. Negotiating ₹2 lakh off.' },
  { name: 'Mukesh Sonkar', phone: '+91 94511 06683', loc: 'Mohanlalganj, Lucknow', source: 'Facebook', status: 'Negotiation', priority: 'Warm', agent: 'arjun', prop: 'C-03', type: 'Plot', budget: L(51), created: -52, req: 'Reserved the corner plot with a token. Discussing a 3-installment plan.' },
  // Lost
  { name: 'Ramesh Yadav', phone: '+91 99184 22609', loc: 'Bakshi Ka Talab, Lucknow', source: 'Facebook', status: 'Lost', priority: 'Cold', agent: 'arjun', type: 'Plot', budget: L(15), created: -64, req: 'Wanted a plot under ₹15 lakh.', lost: 'Budget mismatch — looking below ₹15 lakh' },
  { name: 'Pankaj Mishra', phone: '+91 83557 40912', loc: 'Indira Nagar, Lucknow', source: 'Google', status: 'Lost', priority: 'Warm', agent: 'rahul', prop: 'A-702R', type: 'Apartment', budget: L(50), created: -70, req: 'Was comparing 3 BHK options.', lost: 'Booked a ready-to-move flat elsewhere' },
  { name: 'Seema Verma', phone: '+91 70528 19374', loc: 'Chowk, Lucknow', source: 'Instagram', status: 'Lost', priority: 'Cold', agent: 'imran', type: 'Apartment', budget: L(35), created: -73, req: 'Enquired about 2 BHK pricing.', lost: 'Not reachable after 5 attempts' },
  { name: 'Tarun Agarwal', phone: '+91 96217 55028', loc: 'Kalyanpur, Kanpur', source: 'Website', status: 'Lost', priority: 'Cold', agent: 'priya', type: 'Villa', budget: L(80), created: -58, req: 'Wanted a villa closer to Kanpur.', lost: 'Location too far from workplace' },
  { name: 'Lalit Kumar', phone: '+91 88742 09936', loc: 'Raebareli', source: 'Broker', status: 'Lost', priority: 'Warm', agent: 'karan', prop: 'O-201', type: 'Office', budget: L(45), created: -66, req: 'Wanted an office for an insurance agency.', lost: 'Purchase postponed to next year' },
];

// ─── Minimal PDF writer for sample documents ─────────────────────────────
function samplePdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7E]/g, '-');
  const body = [`BT /F1 18 Tf 60 770 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 11 Tf 60 ${735 - i * 18} Td (${esc(l)}) Tj ET`)].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

// ─── Seeder ──────────────────────────────────────────────────────────────
export async function seedDemoIfEmpty() {
  const n = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n;
  if (n > 0) return;
  log.info('loading demo data');
  await db.transaction(seedDemo);
  await syncInstallmentStatuses(true);
  log.info('demo data ready');
}

async function seedDemo() {
  const ids: Record<string, number> = {};
  const uid = (k: UserKey | null) => (k ? ids[`u:${k}`] : null);
  const first = (k: UserKey) => USERS.find((u) => u.key === k)!.name.split(' ')[0];

  await db.run("INSERT INTO settings (key, value) VALUES ('_demo_data', 'true') ON CONFLICT(key) DO NOTHING");

  for (const u of USERS) {
    ids[`u:${u.key}`] = await db.insert('users', {
      name: u.name, email: u.email, password_hash: bcrypt.hashSync(u.password, 10), role: u.role, phone: u.phone, title: u.title,
      status: 'status' in u ? u.status : 'Active', last_login: u.key === 'imran' ? DT(-48, '18:20') : DT(-Math.floor(rand() * 3), hm()), created_at: DT(-400, '10:00'),
    });
  }

  for (const [i, p] of PROPERTIES.entries()) {
    ids[`p:${p.key}`] = await db.insert('properties', {
      code: `PR-${3001 + i}`, name: p.name, project: p.project, location: PROJECT.location, city: PROJECT.city, type: p.type, unit_number: p.unit, tower: p.tower,
      floor: p.floor ?? null, bedrooms: p.bed ?? null, bathrooms: p.bath ?? null, area_sqft: p.area, price: p.price, status: p.status, facing: p.facing,
      furnishing: p.furnishing ?? null, parking: p.parking ?? 0, possession: POSSESSION[p.project], construction_stage: STAGE_FOR[p.project], description: p.desc, amenities: AMENITY_FOR[p.project],
      assigned_to: uid(p.agent), created_at: DT(-420, '10:00'), updated_at: DT(-30, '10:00'),
    });
  }
  const prop = (k: string) => PROPERTIES.find((p) => p.key === k)!;

  // Leads: converted (from customers) + open, inserted in creation order so codes ascend.
  type AnyLead = LeadSeed & { cust?: Cust };
  const all: AnyLead[] = [
    ...CUSTOMERS.map((c, i): AnyLead => ({
      name: c.name, phone: c.phone, email: c.email, loc: c.address.split(',').slice(-2, -1)[0]?.trim() + ', ' + c.city, source: c.source,
      status: c.stage === 'Registration' ? 'Closed' : 'Booked', priority: 'Hot', agent: c.agent, prop: c.prop, type: prop(c.prop).type,
      budget: Math.round(c.value / 100000) * 100000, created: c.booked - 25 - (i % 5) * 7, req: `Interested in ${prop(c.prop).name.toLowerCase()} at ${prop(c.prop).project}.`, cust: c,
    })),
    ...LEADS,
  ].sort((a, b) => a.created - b.created);

  const leadIds = new Map<string, number>();
  let code = 1001;
  for (const l of all) {
    const created = DT(l.created, hm());
    const id = await db.insert('leads', {
      code: `LD-${code++}`, name: l.name, phone: l.phone, phone_norm: normalizePhone(l.phone), email: l.email ?? null, location: l.loc, source: l.source, property_id: l.prop ? ids[`p:${l.prop}`] : null,
      property_type: l.type, budget: l.budget, requirement: l.req, status: l.status, priority: l.priority, assigned_to: uid(l.agent),
      lost_reason: l.lost ?? null, created_by: uid(l.agent) ?? ids['u:neha'], created_at: created, updated_at: created,
    });
    leadIds.set(l.name, id);
  }

  // Customers, deals, installments, payments (customer codes ascend with booking date).
  const pays: { cust: number; inst: number; prop: number; lead: number; type: string; amount: number; method: string; date: string; ref: string; status: string; agent: number; name: string; label: string }[] = [];
  let ccode = 2001;
  let dcode = 5001;
  for (const c of [...CUSTOMERS].sort((a, b) => a.booked - b.booked)) {
    const p = prop(c.prop);
    const leadId = leadIds.get(c.name)!;
    const done = c.stage === 'Registration';
    const custId = await db.insert('customers', {
      code: `CU-${ccode++}`, lead_id: leadId, name: c.name, phone: c.phone, email: c.email, address: c.address, city: c.city, occupation: c.occupation,
      pan: c.pan, aadhaar: c.aadhaar, property_id: ids[`p:${c.prop}`], booking_date: D(c.booked), total_value: c.value, status: done ? 'Completed' : 'Active',
      assigned_to: uid(c.agent), created_at: DT(c.booked, '12:30'),
    });
    ids[`c:${c.name}`] = custId;
    await db.update('leads', leadId, { customer_id: custId, updated_at: DT(c.booked, '12:30') });
    const dealId = await db.insert('deals', {
      code: `DL-${dcode++}`, lead_id: leadId, customer_id: custId, property_id: ids[`p:${c.prop}`], agent_id: uid(c.agent), value: c.value,
      booking_amount: L(c.plan[0][2]), discount: Math.max(0, p.price - c.value), stage: c.stage ?? 'Booked', status: done ? 'Won' : 'Open',
      booking_date: D(c.booked), closed_at: done ? DT(c.plan[c.plan.length - 1][1] + 20, '15:00') : null, created_at: DT(c.booked, '12:30'),
    });
    const instIds: number[] = [];
    const paidBy: number[] = c.plan.map(() => 0);
    for (const pay of c.pays) if ((pay[5] ?? 'Completed') === 'Completed') paidBy[pay[0] - 1] += L(pay[1]);
    for (const [i, [label, due, lakh]] of c.plan.entries()) {
      const lastPay = c.pays.filter((x) => x[0] === i + 1 && (x[5] ?? 'Completed') === 'Completed').map((x) => x[3]).sort((a, b) => b - a)[0];
      instIds.push(await db.insert('installments', {
        customer_id: custId, deal_id: dealId, number: i + 1, label, due_date: D(due), amount: L(lakh), paid_amount: paidBy[i],
        status: installmentStatus(L(lakh), paidBy[i], D(due)), payment_date: lastPay !== undefined ? D(lastPay) : null, created_at: DT(c.booked, '12:30'),
      }));
    }
    for (const [no, lakh, method, day, ref, status] of c.pays) {
      pays.push({ cust: custId, inst: instIds[no - 1], prop: ids[`p:${c.prop}`], lead: leadId, type: no === 1 ? 'Booking Amount' : 'Installment', amount: L(lakh), method, date: D(day), ref, status: status ?? 'Completed', agent: uid(c.agent)!, name: c.name, label: c.plan[no - 1][0] });
    }
  }

  // Transactions in date order so receipt numbers run sequentially per financial year.
  pays.sort((a, b) => a.date.localeCompare(b.date));
  const receiptSeq: Record<string, number> = {};
  for (const t of pays) {
    const fy = financialYear(new Date(`${t.date}T12:00:00`)).label;
    const receipt = t.status === 'Completed' ? `SWR/${fy}/${String((receiptSeq[fy] = (receiptSeq[fy] ?? 0) + 1)).padStart(4, '0')}` : null;
    const recorder = pick([ids['u:pooja'], ids['u:manish']]);
    const id = await db.insert('transactions', {
      code: 'TMP', receipt_number: receipt, customer_id: t.cust, property_id: t.prop, installment_id: t.inst, type: t.type, amount: t.amount, method: t.method,
      payment_date: t.date, reference: t.ref, status: t.status,
      notes: t.status === 'Pending' ? 'Cheque deposited — awaiting clearance' : t.status === 'Failed' ? 'Cheque returned unpaid — insufficient funds. Customer informed.' : t.method === 'Finance' ? 'Disbursement received from lender' : null,
      recorded_by: recorder, created_at: new Date(`${t.date}T${hm()}:00`).toISOString(),
    });
    await db.update('transactions', id, { code: `TXN-${100000 + id}` });
    const amt = `₹${t.amount.toLocaleString('en-IN')}`;
    await db.insert('activities', {
      lead_id: t.lead, customer_id: t.cust, property_id: t.prop, type: 'payment', user_id: recorder, created_at: new Date(`${t.date}T16:10:00`).toISOString(),
      title: t.status === 'Completed' ? 'Payment received' : t.status === 'Pending' ? 'Payment recorded — awaiting clearance' : 'Payment failed / bounced',
      description: `${amt} via ${t.method} for ${t.label} · Ref ${t.ref}`,
    });
  }

  for (const [fy, n] of Object.entries(receiptSeq)) {
    await db.run('INSERT INTO receipt_sequences (fy, last_number) VALUES (?, ?) ON CONFLICT(fy) DO UPDATE SET last_number = excluded.last_number', [fy, n]);
  }

  // Timelines, follow-ups and site visits per lead.
  const ORDER = ['New', 'Contacted', 'Qualified', 'Site Visit', 'Negotiation', 'Booked', 'Closed'];
  const act = (lead: number, created: string, type: string, title: string, description: string | null, user: number | null, customer?: number) =>
    db.insert('activities', { lead_id: lead, customer_id: customer ?? null, type, title, description, user_id: user, created_at: created });
  const visitTimes = ['11:00', '13:30', '15:00', '16:30'];
  // Field check-in/out near the Green Valley sales office (Mohanlalganj), about an hour apart.
  const SITE = { lat: 26.6863, lng: 80.9876 };
  const jitter = () => Math.round((rand() - 0.5) * 0.004 * 1e6) / 1e6;
  const checkIn = (day: number, time: string, outcome: string) => {
    const [h, m] = time.split(':').map(Number);
    const out = `${String(Math.min(21, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return {
      outcome,
      checked_in_at: DT(day, time), checkin_lat: SITE.lat + jitter(), checkin_lng: SITE.lng + jitter(),
      checked_out_at: DT(day, out), checkout_lat: SITE.lat + jitter(), checkout_lng: SITE.lng + jitter(),
    };
  };

  for (const l of all) {
    const leadId = leadIds.get(l.name)!;
    const agent = uid(l.agent) ?? ids['u:neha'];
    const ag = l.agent ? first(l.agent) : 'Neha';
    const p = l.prop ? prop(l.prop) : null;
    const pLabel = p ? `${p.project} · ${p.unit}` : 'Green Valley';
    const end = l.cust ? l.cust.booked : 0;
    const span = Math.max(1, end - l.created);
    const at = (frac: number, h = hm()) => DT(Math.min(end, l.created + Math.max(0, Math.round(span * frac))), h);
    const reached = (s: string) => ORDER.indexOf(l.status === 'Lost' ? 'Contacted' : l.status) >= ORDER.indexOf(s);

    await act(leadId, DT(l.created, '09:40'), 'created', 'Lead created', `Captured from ${l.source}${l.source === 'Broker' ? ' (channel partner)' : ''}`, l.agent ? agent : null);
    if (l.agent && l.source !== 'Walk-in') await act(leadId, DT(l.created, '09:45'), 'assigned', `Assigned to ${USERS.find((u) => u.key === l.agent)!.name}`, null, ids['u:neha']);
    if (reached('Contacted')) {
      await act(leadId, at(0.08, '11:20'), 'call', `Called by ${ag}`, pick(['Discussed requirement and budget. Shared project overview.', 'Explained location advantages and payment plans.', 'Introductory call — customer requested brochure.']), agent);
      await act(leadId, at(0.1, '11:35'), 'status', 'Moved to Contacted', 'Stage changed from New to Contacted', agent);
      await act(leadId, at(0.12, '12:05'), 'whatsapp', 'Brochure sent', `Sent the ${p?.project ?? 'Starwiz Green Valley'} brochure and price list on WhatsApp`, agent);
      await db.update('leads', leadId, { last_contact: at(0.12, '12:05') });
    }
    if (reached('Qualified')) await act(leadId, at(0.25, '15:10'), 'status', 'Moved to Qualified', 'Budget and timeline confirmed', agent);
    if (reached('Site Visit')) {
      const vd = l.cust ? l.cust.booked + Math.round((l.created - l.cust.booked) * 0.55) : l.status === 'Site Visit' && l.name === 'Megha Kapoor' ? 0 : Math.round(l.created * 0.4);
      const isToday = vd === 0;
      const time = isToday ? '15:00' : pick(visitTimes);
      await act(leadId, DT(vd - 3 < l.created ? l.created : vd - 3, '17:30'), 'site_visit', 'Site visit scheduled', `${pLabel} on ${humanDate(D(vd), time)}`, agent);
      await act(leadId, DT(vd - 3 < l.created ? l.created : vd - 3, '17:31'), 'status', 'Moved to Site Visit', 'Stage changed from Qualified to Site Visit', agent);
      const feedback = pick(['Liked the layout and open spaces. Wants to discuss the payment plan.', 'Happy with the location; concerned about the distance to the city — explained the upcoming road widening.', 'Family visit went well. Asked for the cost sheet with registry charges.', 'Appreciated the clubhouse plans and the 40 ft roads.']);
      await db.insert('site_visits', {
        lead_id: leadId, property_id: p ? ids[`p:${p.key}`] : null, agent_id: agent, visit_date: D(vd), visit_time: time, status: isToday ? 'Scheduled' : 'Completed',
        feedback: isToday ? null : feedback, ...(isToday ? {} : checkIn(vd, time, l.cust ? 'Booked on site' : pick(['Interested', 'Very interested', 'Needs time', 'Price concern']))), next_action: isToday ? 'Walk through the villa and share the cost sheet' : pick(['Share cost sheet', 'Schedule a second visit with family', 'Follow up on loan eligibility', 'Send payment plan']),
        created_by: agent, created_at: DT(Math.max(l.created, vd - 3), '17:30'),
      });
      if (!isToday) await act(leadId, DT(vd, '17:00'), 'site_visit', 'Site visit completed', feedback, agent);
    }
    if (reached('Negotiation')) {
      await act(leadId, at(0.75, '12:40'), 'status', 'Moved to Negotiation', 'Stage changed from Site Visit to Negotiation', agent);
      await act(leadId, at(0.78, '13:00'), 'email', 'Cost sheet shared', `Shared the detailed cost sheet for ${pLabel}`, agent);
    }
    if (l.cust) {
      const custId = ids[`c:${l.name}`];
      await act(leadId, DT(l.cust.booked, '12:30'), 'conversion', 'Converted to customer', `${pLabel} booked for ₹${l.cust.value.toLocaleString('en-IN')}`, agent, custId);
      await act(leadId, DT(l.cust.booked, '12:31'), 'status', 'Moved to Booked', 'Booking confirmed', agent, custId);
      if (l.cust.stage) await act(leadId, DT(l.cust.booked + 30, '11:00'), 'deal', `Deal moved to ${l.cust.stage}`, null, agent, custId);
    }
    if (l.status === 'Lost') await act(leadId, DT(l.created + 15, '18:00'), 'status', 'Moved to Lost', `Reason: ${l.lost}`, agent);
  }

  // Hand-crafted timeline for the flagship demo lead.
  const anupam = leadIds.get('Dr. Anupam Shukla')!;
  await act(anupam, DT(-46, '09:45'), 'note', 'Note added', 'Referred by Saurabh Tripathi (Plot A-18). Prefers calls after 7 PM on weekdays.', ids['u:rahul']);
  await act(anupam, DT(-6, '19:20'), 'call', 'Called by Rahul', 'Discussed a 10% booking with the balance linked to construction stages. Wants ₹3 lakh off on the PLC.', ids['u:rahul']);
  await act(anupam, DT(-2, '12:15'), 'note', 'Note added', 'Approved by Neha: up to ₹2.5 lakh discount on PLC if booked this month.', ids['u:neha']);

  // Follow-ups across all open leads: completed history + today / overdue / upcoming.
  const FU_NOTES: Record<string, string[]> = {
    Call: ['Confirm budget and preferred plot size', 'Share updated price list', 'Check loan eligibility status', 'Discuss payment plan options', 'Remind about site visit timing'],
    WhatsApp: ['Send brochure and location map', 'Share villa walkthrough video', 'Send cost sheet PDF', 'Share construction progress photos'],
    Email: ['Email detailed cost sheet', 'Send allotment terms', 'Share bank tie-up list'],
    Meeting: ['Meet at the Ashiyana office to finalise terms', 'Family meeting to discuss booking'],
    'Site Visit': ['Pick-up arranged from Gomti Nagar for site visit', 'Second site visit with family'],
  };
  const fu = async (lead: number, agent: number, day: number, time: string, type: string, status: string, notes?: string) => {
    await db.insert('followups', {
      lead_id: lead, agent_id: agent, due_date: D(day), due_time: time, type, notes: notes ?? pick(FU_NOTES[type]), status,
      outcome: status === 'Completed' ? pick(['Spoke to customer — positive response', 'Customer requested a call back next week', 'Shared details as discussed']) : status === 'Missed' ? 'Customer did not answer' : null,
      completed_at: status === 'Completed' ? DT(day, time) : null, created_by: agent, created_at: DT(Math.min(day - 2, 0), '10:00'),
    });
  };
  const open = all.filter((l) => !l.cust && l.status !== 'Lost');
  const plan: [string, number, string, string, string?][] = [
    ['Dr. Anupam Shukla', 0, '19:30', 'Call', 'Confirm final PLC discount and booking date'],
    ['Megha Kapoor', 0, '12:00', 'WhatsApp', 'Share location pin and confirm 3 PM visit'],
    ['Tanvi Mehrotra', 0, '11:30', 'Call', 'Share villa V-18 cost sheet with HDFC loan schedule'],
    ['Devendra Pal', 0, '16:00', 'Meeting', 'Final negotiation meeting at the Ashiyana office'],
    ['Sandeep Jaiswal', 0, '17:30', 'Email', 'Email layout of the restaurant space with frontage dimensions'],
    ['Ayesha Naqvi', 0, '20:00', 'WhatsApp', 'Video walkthrough of villa V-18 (Dubai time 6:30 PM)'],
    ['Harsh Vardhan Singh', -1, '18:00', 'Call'],
    ['Nidhi Upadhyay', -2, '13:00', 'Call'],
    ['Aman Rizvi', -3, '11:00', 'WhatsApp'],
    ['Swati Kesarwani', -1, '15:30', 'Call', 'Check status of LIC HFL loan sanction'],
    ['Deepika Kushwaha', 1, '12:30', 'Site Visit', 'Site visit for villa V-14 with family'],
    ['Rashmi Pathak', 1, '17:00', 'Call'],
    ['Kunal Bhatia', 2, '11:00', 'Meeting'],
    ['Mukesh Sonkar', 2, '16:30', 'Call', 'Collect balance token and confirm installment plan'],
    ['Nitin Awasthi', 3, '10:30', 'Call'],
    ['Shweta Bajpai', 3, '18:30', 'Email'],
    ['Farhan Abbasi', 4, '12:00', 'Call'],
    ['Rekha Chauhan', 5, '11:00', 'Site Visit', 'Clubhouse progress visit with son'],
    ['Manoj Chaurasia', 1, '10:00', 'Call'],
    ['Arvind Maurya', 2, '14:00', 'WhatsApp'],
    ['Ritu Saxena', 6, '15:00', 'Email'],
    ['Vikas Chaudhary', 0, '10:30', 'Call', 'First call — share plot B-22 price list'],
    ['Yogesh Rawat', 1, '11:30', 'Call'],
    ['Divya Sinha', 1, '16:00', 'WhatsApp'],
  ];
  for (const [name, day, time, type, note] of plan) {
    const l = all.find((x) => x.name === name)!;
    await fu(leadIds.get(name)!, uid(l.agent) ?? ids['u:neha'], day, time, type, 'Pending', note);
  }
  for (const l of open) {
    if (l.status === 'New') continue;
    const agent = uid(l.agent) ?? ids['u:neha'];
    await fu(leadIds.get(l.name)!, agent, Math.round(l.created * 0.7), pick(['11:00', '12:30', '16:00']), pick(['Call', 'WhatsApp']), 'Completed');
    if (rand() > 0.55) await fu(leadIds.get(l.name)!, agent, Math.round(l.created * 0.35), pick(['10:30', '18:00']), 'Call', rand() > 0.75 ? 'Missed' : 'Completed');
  }

  // Additional upcoming site visits (today + this week) and a couple of changed plans.
  const visits: [string, number, string, string, string?][] = [
    ['Nitin Awasthi', 0, '11:00', 'Completed', 'Second visit with his father. Shortlisted plot B-15; wants registry charges in writing.'],
    ['Shweta Bajpai', 0, '17:00', 'Scheduled'],
    ['Dr. Anupam Shukla', 1, '12:30', 'Scheduled'],
    ['Farhan Abbasi', 2, '11:30', 'Scheduled'],
    ['Devendra Pal', 3, '16:00', 'Rescheduled'],
    ['Rekha Chauhan', 5, '11:00', 'Scheduled'],
    ['Swati Kesarwani', -4, '12:00', 'Cancelled', 'Customer cancelled — travelling out of station'],
  ];
  for (const [name, day, time, status, feedback] of visits) {
    const l = all.find((x) => x.name === name)!;
    const agent = uid(l.agent) ?? ids['u:neha'];
    await db.insert('site_visits', {
      lead_id: leadIds.get(name)!, property_id: l.prop ? ids[`p:${l.prop}`] : null, agent_id: agent, visit_date: D(day), visit_time: time, status,
      feedback: feedback ?? null, ...(status === 'Completed' ? checkIn(day, time, 'Very interested') : {}), next_action: status === 'Completed' ? 'Send loan schedule and block the unit' : status === 'Cancelled' ? 'Reschedule after customer returns' : 'Confirm pick-up and share location',
      created_by: agent, created_at: DT(Math.min(day, 0) - 2, '18:00'),
    });
    if (status === 'Completed') await act(leadIds.get(name)!, DT(0, '12:10'), 'site_visit', 'Site visit completed', feedback ?? null, agent);
    else await act(leadIds.get(name)!, DT(Math.min(day, 0) - 2, '18:00'), 'site_visit', status === 'Cancelled' ? 'Site visit cancelled' : 'Site visit scheduled', `${l.prop ? prop(l.prop).project + ' · ' + prop(l.prop).unit : 'Green Valley'} on ${humanDate(D(day), time)}`, agent);
  }

  // Past-due follow-ups were already flagged, so the scheduler does not re-announce the seeded backlog.
  await db.run("UPDATE followups SET overdue_at = ? WHERE status = 'Pending' AND (due_date || 'T' || due_time) < ?", [new Date().toISOString(), `${T}T${new Date().toTimeString().slice(0, 5)}`]);

  // A repeat enquiry under a slightly different spelling, to demonstrate duplicate detection and merge.
  const vikas = all.find((x) => x.name === 'Vikas Chaudhary')!;
  const dupCreated = DT(-1, '20:15');
  const dupId = await db.insert('leads', {
    code: `LD-${code++}`, name: 'Vikas Choudhary', phone: vikas.phone.replace(/^\+91 /, '0'), phone_norm: normalizePhone(vikas.phone), email: null,
    location: vikas.loc, source: 'Facebook', source_detail: 'Plots lead form', property_type: 'Plot', budget: vikas.budget, requirement: 'Asked for the plot price list again.',
    status: 'New', priority: 'Warm', assigned_to: null, created_by: null, created_at: dupCreated, updated_at: dupCreated,
  });
  leadIds.set('Vikas Choudhary', dupId);
  await act(dupId, dupCreated, 'created', 'Lead created', 'Captured from Facebook · Plots lead form', null);

  // Customer app requests and a pending password reset for the admin to handle.
  const req = async (customer: string, type: string, subject: string, message: string, status: string, day: number, response?: string, by?: UserKey) =>
    db.insert('customer_requests', {
      customer_id: ids[`c:${customer}`], user_id: customer === 'Amit Sharma' ? ids['u:amit'] : null, type, subject, message, status,
      preferred_date: type === 'Site visit' ? D(day + 4) : null, response: response ?? null, handled_by: by ? ids[`u:${by}`] : null,
      created_at: DT(day, '10:15'), updated_at: response ? DT(day + 1, '12:00') : null,
    });
  await req('Amit Sharma', 'Site visit', 'Construction progress visit', 'I would like to see the slab work on my villa with my wife this Saturday.', 'Open', -1);
  await req('Amit Sharma', 'Document', 'Copy of allotment letter', 'Please upload the allotment letter for my home-loan file.', 'Resolved', -12, 'Uploaded to your documents. The bank copy is also with the accounts desk.', 'rahul');
  await req('Rohit Srivastava', 'Payment', 'Change installment date', 'Can the On Foundation installment be moved to the 25th?', 'In Progress', -2, 'Checking with accounts; we will call you tomorrow.', 'pooja');
  await db.insert('password_reset_requests', { user_id: ids['u:priya'], email: 'priya@demo.com', note: 'Forgot password after changing phone', status: 'Pending', requested_at: DT(0, '09:05') });

  // Sync derived lead fields
  for (const id of leadIds.values()) {
    const next = await db.get<{ at: string }>("SELECT due_date || 'T' || due_time AS at FROM followups WHERE lead_id = ? AND status = 'Pending' ORDER BY due_date, due_time LIMIT 1", [id]);
    const last = await db.get<{ at: string }>("SELECT MAX(created_at) AS at FROM activities WHERE lead_id = ? AND type IN ('call','whatsapp','email','site_visit','followup','conversion','payment')", [id]);
    const upd = await db.get<{ at: string }>('SELECT MAX(created_at) AS at FROM activities WHERE lead_id = ?', [id]);
    await db.update('leads', id, { next_followup: next?.at ?? null, last_contact: last?.at ?? null, updated_at: upd?.at });
  }

  // Tasks
  const TASKS: [string, UserKey, string, number | null, string | null, string, string?][] = [
    ['Prepare final cost sheet for villa V-22 with revised PLC', 'rahul', 'Urgent', 0, 'Dr. Anupam Shukla', 'In Progress'],
    ['Collect KYC documents (PAN, Aadhaar) for booking', 'rahul', 'High', 2, 'Dr. Anupam Shukla', 'Todo'],
    ['Arrange site pick-up for Megha Kapoor family', 'rahul', 'High', 0, 'Megha Kapoor', 'Completed'],
    ['Follow up with Canara Bank on cheque CHQ 006247 clearance', 'pooja', 'High', 1, null, 'Todo', 'Vivek Pandey'],
    ['Send overdue reminder to Rohit Srivastava (On Foundation)', 'manish', 'Urgent', -1, null, 'Todo', 'Rohit Srivastava'],
    ['Re-present bounced cheque or collect NEFT from Priyanka Shukla', 'pooja', 'Urgent', 0, null, 'In Progress', 'Priyanka Shukla'],
    ['Weekly pipeline review with sales team', 'neha', 'Medium', 1, null, 'Todo'],
    ['Assign new website and Instagram leads', 'neha', 'High', 0, null, 'Todo'],
    ['Share villa walkthrough video with NRI lead', 'rahul', 'Medium', 1, 'Ayesha Naqvi', 'Todo'],
    ['Prepare restaurant zone layout for Sandeep Jaiswal', 'priya', 'High', 2, 'Sandeep Jaiswal', 'Todo'],
    ['Update registry charges sheet for Phase 1 plots', 'arjun', 'Low', 5, null, 'Todo'],
    ['Coordinate with channel partner Lucknow Homes on payout', 'karan', 'Medium', 3, 'Arvind Maurya', 'In Progress'],
    ['Monthly collection report for management', 'pooja', 'Medium', 4, null, 'Todo'],
    ['Send registry documents to Gaurav Rastogi', 'arjun', 'Low', -10, null, 'Completed', 'Gaurav Rastogi'],
  ];
  for (const [title, who, priority, due, lead, status, customer] of TASKS) {
    await db.insert('tasks', {
      title, description: null, assigned_to: ids[`u:${who}`], created_by: ['neha', 'pooja', 'manish'].includes(who) ? ids['u:admin'] : ids['u:neha'], priority,
      due_date: due === null ? null : D(due), lead_id: lead ? leadIds.get(lead) : null, customer_id: customer ? ids[`c:${customer}`] : null, status,
      completed_at: status === 'Completed' ? DT(Math.min(due ?? 0, 0), '17:00') : null, created_at: DT(Math.min(due ?? 0, 0) - 4, '10:00'),
    });
  }

  // Sample documents (generated PDFs, clearly marked as samples)
  fs.mkdirSync(config.uploadDir, { recursive: true });
  let docN = 0;
  const doc = async (entity: string, entityId: number, docType: string, name: string, lines: string[], by: number, day: number) => {
    const file = `demo-${++docN}.pdf`;
    const buf = samplePdf(name.replace(/\.pdf$/, ''), [...lines, '', 'Sample document generated for the EstateFlow CRM demo.']);
    fs.writeFileSync(path.join(config.uploadDir, file), buf);
    await db.insert('documents', { entity_type: entity, entity_id: entityId, name, doc_type: docType, file_name: file, mime: 'application/pdf', size: buf.length, uploaded_by: by, created_at: DT(day, '15:20') });
  };
  for (const c of CUSTOMERS) {
    const id = ids[`c:${c.name}`];
    const p = prop(c.prop);
    const slug = c.name.replace(/[^A-Za-z ]/g, '').replace(/ +/g, '_');
    await doc('customer', id, 'Booking Form', `Booking_Form_${slug}.pdf`, [`Customer: ${c.name}`, `Unit: ${p.project} ${p.unit}`, `Booking date: ${D(c.booked)}`, `Agreed value: INR ${c.value.toLocaleString('en-IN')}`], uid(c.agent)!, c.booked);
    await doc('customer', id, 'PAN', `PAN_${slug}.pdf`, [`PAN card copy — ${c.name}`, `PAN: ${c.pan}`], uid(c.agent)!, c.booked);
    if (['Amit Sharma', 'Rohit Srivastava', 'Alok Dwivedi', 'Neha Agarwal'].includes(c.name) || c.stage) {
      await doc('customer', id, 'Aadhaar', `Aadhaar_${slug}.pdf`, [`Aadhaar copy (masked) — ${c.name}`, `Aadhaar: ${c.aadhaar}`], uid(c.agent)!, c.booked);
      await doc('customer', id, 'Agreement', `Agreement_to_Sell_${p.unit}.pdf`, [`Agreement to sell — ${p.project} ${p.unit}`, `Between Starwiz Realty Pvt. Ltd. and ${c.name}`], ids['u:neha'], c.booked + 28);
    }
  }
  await doc('lead', anupam, 'Requirement', 'Requirement_Dr_Anupam_Shukla.pdf', ['Requirement summary', '4 BHK corner villa, Vastu-compliant entrance', 'Home-office room on ground floor', 'Budget: INR 1.45 Cr'], ids['u:rahul'], -40);
  await doc('lead', anupam, 'ID Proof', 'ID_Proof_Anupam_Shukla.pdf', ['Driving licence copy — Dr. Anupam Shukla'], ids['u:rahul'], -6);
  await doc('lead', leadIds.get('Megha Kapoor')!, 'Requirement', 'Requirement_Megha_Kapoor.pdf', ['4 BHK east-facing villa', 'Possession needed by early 2028'], ids['u:rahul'], -10);
  for (const project of Object.keys(AMENITY_FOR)) {
    const first = PROPERTIES.find((p) => p.project === project)!;
    await doc('property', ids[`p:${first.key}`], 'Property Documents', `${project.replace(/ /g, '_')}_Brochure.pdf`, [`${project} — Starwiz Green Valley`, 'Nigohan-Samesi Road, Mohanlalganj, Lucknow', 'Amenities, layout and payment plans'], ids['u:admin'], -200);
  }
  await doc('property', ids['p:V-22'], 'Property Documents', 'Villa_V-22_Floor_Plan.pdf', ['Signature villa V-22', '4 BHK, 2,850 sq ft built-up area'], ids['u:admin'], -120);

  // Notifications reflecting the seeded activity
  const note = async (who: UserKey, type: string, title: string, message: string, link: string | null, minutesAgo: number, read = false) =>
    db.insert('notifications', { user_id: ids[`u:${who}`], type, title, message, link, is_read: read ? 1 : 0, created_at: new Date(Date.now() - minutesAgo * 60000).toISOString() });
  const amitId = ids['c:Amit Sharma'];
  const overdueCount = async (agent: UserKey | null) =>
    (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM followups WHERE status = 'Pending' AND due_date < ?${agent ? ' AND agent_id = ?' : ''}`, agent ? [T, ids[`u:${agent}`]] : [T]))!.n;
  for (const who of ['admin', 'pooja', 'manish'] as UserKey[]) {
    await note(who, 'payment', 'Payment received', 'Payment of ₹2,50,000 received from Amit Sharma.', `/customers/${amitId}`, 60 * 24 * 3, who !== 'admin');
    await note(who, 'payment', 'Cheque awaiting clearance', 'Payment of ₹13,25,000 recorded from Vivek Pandey (cheque).', `/customers/${ids['c:Vivek Pandey']}`, 60 * 24 * 2);
    await note(who, 'alert', 'Payment failed', '₹8,00,000 cheque from Priyanka Shukla was returned unpaid.', `/customers/${ids['c:Priyanka Shukla']}`, 60 * 24 * 9, true);
    await note(who, 'installment', 'Installment due tomorrow', 'Installment of ₹6,60,000 from Anjali Mishra is due tomorrow.', `/customers/${ids['c:Anjali Mishra']}`, 90);
    await note(who, 'deal', 'New booking', 'Rajesh Gupta booked Green Valley Plots C-11 for ₹29,25,000.', `/customers/${ids['c:Rajesh Gupta']}`, 60 * 24 * 8, true);
  }
  await note('admin', 'alert', 'Overdue follow-ups', `${await overdueCount(null)} overdue follow-ups require attention.`, '/followups?bucket=overdue', 45);
  await note('neha', 'alert', 'Overdue follow-ups', `${await overdueCount(null)} overdue follow-ups require attention.`, '/followups?bucket=overdue', 40);
  await note('neha', 'lead', 'New leads to assign', '2 new leads from Instagram and Google are unassigned.', '/leads?agent=unassigned', 120);
  await note('neha', 'deal', 'New booking', 'Rajesh Gupta booked Green Valley Plots C-11 for ₹29,25,000.', `/customers/${ids['c:Rajesh Gupta']}`, 60 * 24 * 8, true);
  await note('rahul', 'site_visit', 'Site visit today', 'Site visit scheduled for 3:00 PM — Megha Kapoor, Green Valley Villas V-14.', `/leads/${leadIds.get('Megha Kapoor')}`, 30);
  await note('rahul', 'alert', 'Overdue follow-ups', `${await overdueCount('rahul')} overdue follow-ups require attention.`, '/followups?bucket=overdue', 50);
  await note('rahul', 'lead', 'New lead assigned', 'Ayesha Naqvi (Facebook · NRI) has been assigned to you.', `/leads/${leadIds.get('Ayesha Naqvi')}`, 60 * 24 * 3, true);
  await note('rahul', 'payment', 'Payment received', 'Payment of ₹2,50,000 received from Amit Sharma.', `/customers/${amitId}`, 60 * 24 * 3, true);
  await note('amit', 'installment', 'Upcoming installment', `Your next installment of ₹5,00,000 (On Plinth) is due on ${humanDate(D(next15(1)))}.`, '/payments', 60 * 6);
  await note('amit', 'payment', 'Payment received — thank you', 'We have received ₹2,50,000 towards On Foundation. Your receipt is ready.', '/payments', 60 * 24 * 3, true);
  await note('amit', 'document', 'Agreement uploaded', 'Your Agreement to Sell for villa V-03 is now available in Documents.', '/documents', 60 * 24 * 130, true);

  // Link the customer portal login.
  await db.update('users', ids['u:amit'], { customer_id: amitId });
}
