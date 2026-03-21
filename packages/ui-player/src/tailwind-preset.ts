/** Tailwind CSS preset for @hyperframes/ui-player components. */
export const hyperframesPlayerPreset = {
  theme: {
    extend: {
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      borderRadius: {
        card: "12px",
        "card-inner": "8px",
      },
      boxShadow: {
        float: "0 2px 4px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)",
      },
    },
  },
};
