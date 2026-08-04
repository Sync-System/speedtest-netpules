import type { ClientInfo } from "../lib/speedTest";

interface ConnectionInfoProps {
  clientInfo: ClientInfo | null;
  device: string;
}

function formatLocation(info: ClientInfo | null): string {
  if (!info) return "Detecting…";
  const parts = [info.city, info.region, info.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Unknown";
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      {/* Never truncated, on any field. This used to truncate ISP/Location
          only, on the assumption that IP and Device were short and
          fixed-shape enough to always fit — measured at a 320px viewport,
          "72.255.21.195" itself truncated to "72.255.21.1…", silently
          dropping real digits. A shortened ISP name is merely incomplete;
          a shortened IP address is factually wrong, and this is the exact
          field a user checks against another site. Wrapping costs at most
          one extra line; truncating any of these risks showing false data. */}
      <dd className={`text-sm font-semibold text-foreground ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

export function ConnectionInfo({ clientInfo, device }: ConnectionInfoProps) {
  return (
    // A grid rather than a wrapping flex row. With four items of very uneven
    // width ("IP" vs a full ISP name), flex-wrap produced ragged half-empty
    // rows on narrow screens and left the longest item stranded on its own
    // line. Fixed columns keep the labels aligned at every width.
    <dl className="grid w-full max-w-3xl grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-5 py-4 sm:grid-cols-4">
      <Field label="ISP" value={clientInfo?.isp ?? "Detecting…"} />
      <Field label="Your IP" value={clientInfo?.ip ?? "detecting…"} mono />
      <Field label="Location" value={formatLocation(clientInfo)} />
      <Field label="Device" value={device} />
    </dl>
  );
}
