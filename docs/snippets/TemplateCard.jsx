export function TemplateCard({ id, title, description, href, portrait }) {
  const [hovering, setHovering] = React.useState(false);

  const imgSrc = `/images/templates/${id}.png`;
  const videoSrc = `/images/templates/${id}.mp4`;

  return (
    <a
      href={href}
      className="not-prose group block rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden transition-shadow hover:shadow-lg no-underline"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        className="relative overflow-hidden bg-gray-100 dark:bg-gray-800"
        style={{ aspectRatio: portrait ? "9/16" : "16/9" }}
      >
        <img
          src={imgSrc}
          alt={`${title} example`}
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            opacity: hovering ? 0 : 1,
            transition: "opacity 0.2s ease",
          }}
        />
        {hovering && (
          <video
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
      </div>
      <div className="p-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white m-0">
          {title}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-0">
          {description}
        </p>
      </div>
    </a>
  );
}

export function TemplateGrid({ children }) {
  return (
    <div
      className="not-prose grid gap-4"
      style={{ gridTemplateColumns: "repeat(2, 1fr)" }}
    >
      {children}
    </div>
  );
}
