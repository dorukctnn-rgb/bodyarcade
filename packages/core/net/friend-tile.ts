// What the tile of each friend shows during a race, as plain data the screens draw (builder N). The picture of a friend's camera
// is a bonus: it is on the tile only while it really flows. Every other moment (camera not shared, still connecting, failed, a
// device that cannot make the link) the tile draws the friend as a skeleton from the state frames that reach this page through
// the Room relay whatever the camera link does, so a tile is never empty and the match never waits for a picture.
//
// The strings are the shell's own keys (core/ui/i18n): 'room.video.connecting' and 'room.video.failed' for the note under the
// tile ("Kamera bağlanamadı, iskelet görüntüsüyle devam ediyoruz"), and 'common.retry' for the button, which calls
// `race.retryVideo(seat)` (LiveRace) or `client.retryVideo(seat)` (LiveClient).
import type { MemberInfo, SeatId } from '../types/net.ts';
import type { VideoStatus } from './video.ts';

export type TileNote = 'room.video.connecting' | 'room.video.failed';

export interface FriendTile {
  seat: SeatId;
  name: string;
  online: boolean;
  /** The camera picture only while it flows; otherwise the skeleton. */
  show: 'video' | 'skeleton';
  /** Key of the line to show under the tile, or null. */
  note: TileNote | null;
  /** The retry button is offered (a failed link this device can make again). */
  retry: boolean;
}

/** One tile per friend in the room (not the player), in seat order. `videos` are the statuses the client reports (client.videoStatuses()). */
export function friendTiles(members: readonly MemberInfo[], you: SeatId | null, videos: readonly VideoStatus[]): FriendTile[] {
  const by = new Map(videos.map((v) => [v.seat, v] as const));
  return members
    .filter((m) => m.seat !== you)
    .map((m): FriendTile => {
      const v = by.get(m.seat);
      const state = v?.state ?? 'off';
      return {
        seat: m.seat,
        name: m.name,
        online: m.online,
        show: state === 'live' ? 'video' : 'skeleton',
        note: state === 'connecting' ? 'room.video.connecting' : state === 'failed' ? 'room.video.failed' : null,
        retry: state === 'failed' && !!v?.retryable,
      };
    })
    .sort((a, b) => (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0));
}
