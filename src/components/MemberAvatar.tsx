'use client';

import Image from 'next/image';

const AVATAR_COLORS = [
  '#4f46e5', // indigo
  '#0891b2', // cyan
  '#059669', // emerald
  '#d97706', // amber
  '#dc2626', // red
  '#7c3aed', // violet
  '#2563eb', // blue
  '#c026d3', // fuchsia
] as const;

const SIZES = {
  sm: { px: 32, fontSize: '0.8rem' },
  md: { px: 48, fontSize: '1.1rem' },
  lg: { px: 64, fontSize: '1.4rem' },
  xl: { px: 96, fontSize: '2rem' },
} as const;

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface MemberAvatarProps {
  name: string;
  size: AvatarSize;
  photoUrl?: string;
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  // Use first and last name initials, skipping middle initials/names
  const first = parts[0][0];
  const last = parts[parts.length - 1][0];
  return (first + last).toUpperCase();
}

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getColor(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
}

export default function MemberAvatar({ name, size, photoUrl, className }: MemberAvatarProps) {
  const { px, fontSize } = SIZES[size];
  const color = getColor(name);
  const initials = getInitials(name);

  if (photoUrl) {
    return (
      <div
        className={className}
        style={{
          width: px,
          height: px,
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <Image
          src={photoUrl}
          alt={name}
          width={px}
          height={px}
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        width: px,
        height: px,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 700,
        color: '#ffffff',
        fontFamily: 'var(--heading-font)',
        flexShrink: 0,
        userSelect: 'none',
      }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
