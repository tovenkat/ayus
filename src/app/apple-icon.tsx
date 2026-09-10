import { ImageResponse } from "next/og";

// iOS home-screen / Apple touch icon. Generated from the Ayus brand mark so it
// matches icon.svg. PNG with a full-bleed gradient tile (Apple adds its own
// rounded-corner mask, so we fill the whole square).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1aa86f 0%, #24b6b0 100%)",
        }}
      >
        {/* Same leaf + pulse mark as icon.svg, scaled up. */}
        <svg width="132" height="132" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M24 39 C16.5 31.5 9.5 25.5 9.5 17.5 C9.5 12.2 12.8 8.2 18 8.2 C22 8.2 24 11.4 24 11.4 C24 11.4 28 5.6 34 7.8 C40 10 41 16.2 38.8 22.2 C36.6 28 30 33 24 39 Z"
            fill="#ffffff"
            fillOpacity="0.22"
          />
          <polyline
            points="11,23 16.5,23 18.8,18 21.5,29 24,15 26.8,27 29.8,21.5 33,23 37.5,23"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
