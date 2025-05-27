import type { LucideIcon } from 'lucide-react-native';
import { cssInterop } from 'nativewind';

export function iconWithClassName(icon: LucideIcon) {
  // Add safety check for undefined component
  if (!icon) {
    console.error('iconWithClassName: icon is undefined');
    return icon;
  }

  // Add safety check for displayName property
  if (!icon.displayName) {
    icon.displayName = icon.name || 'Icon';
  }

  cssInterop(icon, {
    className: {
      target: 'style',
      nativeStyleToProp: {
        color: true,
        opacity: true,
      },
    },
  });
  
  return icon; // Return the icon after applying cssInterop
}
