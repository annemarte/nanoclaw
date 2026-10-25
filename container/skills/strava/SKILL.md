---
name: strava
description: Read the user's Strava activities (runs, rides, workouts, stats) via the Strava API. Use when the user asks what they trained recently, how much they've done this week, or when choosing/rotating today's workout based on actual history.
---

# Strava (read-only)

Call the Strava API directly with `curl`. The OneCLI gateway injects the `Authorization` header — never ask for, set, or print tokens. Read-only: only GET.

```bash
# Recent activities (newest first)
curl -s "https://www.strava.com/api/v3/athlete/activities?per_page=10"

# Activities since a unix timestamp (e.g. last 7 days)
curl -s "https://www.strava.com/api/v3/athlete/activities?after=$(date -d '7 days ago' +%s)&per_page=50"

# One activity in detail (splits, laps, heart rate)
curl -s "https://www.strava.com/api/v3/activities/<id>"

# Athlete profile and all-time / recent / YTD totals
curl -s "https://www.strava.com/api/v3/athlete"
curl -s "https://www.strava.com/api/v3/athletes/<athlete_id>/stats"
```

## Fields

`name`, `sport_type` (Run, Ride, VirtualRide, WeightTraining, Workout…), `start_date_local`, `distance` (metres), `moving_time` / `elapsed_time` (seconds), `average_speed` (m/s), `average_heartrate`, `total_elevation_gain`. Convert to km, min/km and h:mm for the user.

## Errors

- `401`: token missing or expired. The host refreshes it every few hours; retry once after a minute, then tell the user the Strava link needs attention. Do not ask for credentials.
- `429`: rate limited (100 requests / 15 min). Back off; keep requests few and use `per_page`.
- Private activities only appear if `activity:read_all` was granted.

## Usage

Report concisely. Summarise (count, total distance/time, sport mix) rather than dumping raw JSON.
