/**
 * Design tokens. Dark-first: screenshot thumbnails pop against a dark ground,
 * and the privacy-focused positioning suits a calm, quiet UI.
 */

import { Category } from '../types';

export const colors = {
  background: '#0D1117',
  surface: '#161B22',
  surfaceRaised: '#1F2630',
  border: '#2D333B',
  textPrimary: '#E6EDF3',
  textSecondary: '#9BA7B4',
  textTertiary: '#6E7A87',
  accent: '#4C8DFF',
  accentSoft: '#1B2A45',
  success: '#3FB950',
  warning: '#D29922',
  danger: '#F85149',
  chipBackground: '#21262E',
};

export const categoryColors: Record<Category, string> = {
  payment: '#3FB950',
  bill: '#D29922',
  booking: '#4C8DFF',
  id_document: '#F85149',
  address_contact: '#39C5CF',
  code_coupon: '#BC8CFF',
  chat: '#7EE787',
  job_listing: '#FFA657',
  meme_other: '#8B949E',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.textPrimary },
  heading: { fontSize: 18, fontWeight: '600' as const, color: colors.textPrimary },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.textPrimary },
  secondary: { fontSize: 13, fontWeight: '400' as const, color: colors.textSecondary },
  caption: { fontSize: 11, fontWeight: '500' as const, color: colors.textTertiary },
};
