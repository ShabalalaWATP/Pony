import { ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/domain/StatTile";
import { Tooltip } from "@/components/ui/Tooltip";
import { useAccessPointsList, useDevicesList, useSensorsList } from "@/services/api/queries";

function formatTotal(total: number | undefined): string {
  if (total === undefined) return "—";
  return new Intl.NumberFormat("en-GB").format(total);
}

interface TileProps {
  label: string;
  value: React.ReactNode;
  endpoint: string;
  error?: React.ReactNode;
}

function Tile({ label, value, endpoint, error }: TileProps): JSX.Element {
  if (error) {
    return (
      <Tooltip content={error}>
        <div>
          <StatTile
            label={label}
            value={<span className="text-fg-40">—</span>}
            endpoint={endpoint}
          />
        </div>
      </Tooltip>
    );
  }
  return <StatTile label={label} value={value} endpoint={endpoint} />;
}

export function OverviewKPIs(): JSX.Element {
  const devices = useDevicesList({ limit: 1 });
  const aps = useAccessPointsList({ limit: 1 });
  const sensors = useSensorsList({ limit: 1 });

  const sensorsError =
    sensors.error?.status === 403 ? (
      <span className="flex items-center gap-1.5">
        <ShieldAlert className="size-3" aria-hidden="true" />
        Admin + 2FA required to read sensor inventory.
      </span>
    ) : sensors.error ? (
      <span>Failed to load: {sensors.error.message}</span>
    ) : undefined;

  const devicesError = devices.error ? (
    <span>Failed to load: {devices.error.message}</span>
  ) : undefined;
  const apsError = aps.error ? <span>Failed to load: {aps.error.message}</span> : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="overview-kpis">
      {devices.isLoading ? (
        <Skeleton className="h-26" />
      ) : (
        <Tile
          label="Devices"
          value={formatTotal(devices.data?.total)}
          endpoint="/api/v1/devices"
          error={devicesError}
        />
      )}
      {aps.isLoading ? (
        <Skeleton className="h-26" />
      ) : (
        <Tile
          label="Access Points"
          value={formatTotal(aps.data?.total)}
          endpoint="/api/v1/access_points"
          error={apsError}
        />
      )}
      {sensors.isLoading ? (
        <Skeleton className="h-26" />
      ) : (
        <Tile
          label="Sensors"
          value={formatTotal(sensors.data?.total)}
          endpoint="/api/v1/sensors"
          error={sensorsError}
        />
      )}
    </div>
  );
}
