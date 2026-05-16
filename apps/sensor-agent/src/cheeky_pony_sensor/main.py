# SPDX-License-Identifier: AGPL-3.0-only
"""CLI entrypoint for the Cheeky Pony sensor-agent."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from cheeky_pony_sensor.config import load_config
from cheeky_pony_sensor.service import SensorAgent


def parse_args() -> argparse.Namespace:
    """Parse command line arguments.

    Returns:
        Parsed argument namespace.
    """

    parser = argparse.ArgumentParser(description="Run the Cheeky Pony sensor-agent")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("/etc/cheeky-pony/sensor.toml"),
        help="Path to sensor TOML config",
    )
    return parser.parse_args()


async def async_main() -> None:
    """Load configuration and run the sensor-agent."""

    args = parse_args()
    config = load_config(args.config)
    await SensorAgent(config).run()


def main() -> None:
    """Run the sensor-agent CLI."""

    asyncio.run(async_main())


if __name__ == "__main__":
    main()
