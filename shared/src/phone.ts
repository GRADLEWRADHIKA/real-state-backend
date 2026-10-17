/** Last 10 digits of an Indian mobile (or the full digits for shorter/foreign numbers) — used for duplicate detection. */
export function normalizePhone(phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
const dial = (phone: string) => {
  const d = phone.replace(/[^\d+]/g, '');
  return d.startsWith('+') ? d : d.length === 10 ? `+91${d}` : d;
};
export const telHref = (phone?: string | null) => (phone ? `tel:${dial(phone)}` : undefined);
export const smsHref = (phone?: string | null, text?: string) => (phone ? `sms:${dial(phone)}${text ? `?body=${encodeURIComponent(text)}` : ''}` : undefined);
export const waHref = (phone?: string | null, text?: string) =>
  phone ? `https://wa.me/${dial(phone).replace(/\D/g, '').replace(/^0/, '91')}${text ? `?text=${encodeURIComponent(text)}` : ''}` : undefined;
/** OS map deep link: geo: on Android, which opens whatever maps app the user has installed. */
export const mapsHref = (query: string, lat?: number | null, lng?: number | null) =>
  lat !== undefined && lat !== null && lng !== undefined && lng !== null ? `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(query)})` : `geo:0,0?q=${encodeURIComponent(query)}`;
