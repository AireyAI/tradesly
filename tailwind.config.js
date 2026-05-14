/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './reviews.html',
    './intro.html',
    './privacy.html',
    './terms.html',
    './404.html',
    './admin/reviews.html',
    './quickbook.js',
    './consent.js'
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0A0A0A',
        carbon: '#141414',
        surface: '#1A1A1A',
        edge: '#262626',
        mute: '#9A9A9E',
        bone: '#EDEDED',
        pink: {
          DEFAULT: '#EC0A7E',
          600: '#C70869',
          400: '#F53A9C',
          100: '#FFE1F0'
        }
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'Impact', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      }
    }
  },
  plugins: []
};
