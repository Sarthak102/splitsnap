import { LOGO_PATHS } from '@/lib/brand';

export default function Logo() {
  return (
    <svg className="logo" viewBox="0 0 100 100" role="img" aria-label="SplitSnap logo">
      {LOGO_PATHS.map((path) => <path key={path} d={path} />)}
    </svg>
  );
}
