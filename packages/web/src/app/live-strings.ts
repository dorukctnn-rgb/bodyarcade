// The words of a race in a room, on the stage and on the results screen, that the shell's tables (core/ui/i18n) do not have: who
// the start waits for, who holds the race and why, the Room's 3-2-1, every player's place and points, the rematch and the way back to
// the room. They live under the `lr` namespace (registerGameStrings, the door the games' words and the friends screens use), so the
// shell's tables stay as they are. English is the source; Turkish is complete (the type says so); German, Spanish and French fall
// back to English like every other string. live-strings.test.ts holds them to the copy rules.
import { registerGameStrings, type I18n, type Vars } from '../../../core/ui/i18n/index.ts';

export const en = {
  // ---- the stage, before and during the race ----
  'joining': 'Joining the room',
  'wait.alone': 'Waiting for a second player. Share the link of the room.',
  'wait.one': 'Waiting for {name} to get ready',
  'wait.many': 'Waiting for {n} players to get ready',
  'wait.start': 'Everyone is ready. The race starts in a moment.',
  'watch': 'A race is running in this room. You join the next one.',
  'count': 'The race starts in {n}',
  'go': 'Go',
  'hold.camera': 'Waiting for the camera of {name}',
  'hold.calibrating': '{name} is getting into the frame',
  'hold.framing': '{name} stepped out of the frame',
  'hold.hidden': '{name} left the page for a moment',
  'hold.user': '{name} paused the race',
  'hold.offline': '{name} lost the connection. The race waits.',
  'hold.many': 'The race waits for {n} players',
  'offline': 'Connection lost. Reconnecting.',
  'settle': 'Waiting for the result of the race',
  'tiles': 'The others in the race',
  'left': '{name} left the race',
  'reacts': 'Reactions',
  'said': '{name}: {text}',
  // ---- the results ----
  'result.left.one': '{name} left the race. You win.',
  'result.left.many': 'Everyone else left the race. You win.',
  'result.abandoned': 'The race was called off before anyone finished it.',
  'result.noContest': 'The race ended too early to count, so nobody wins it.',
  'result.early': '{name} left early, so this race does not count.',
  'result.list': 'Places and points',
  'result.place': 'Place {n}',
  'result.you': '{name} (you)',
  'result.forfeit': 'Left',
  'result.keep': 'Keep the run of {name}',
  'result.kept': 'The run of {name} is kept. Race it from the page of the game.',
  'result.keepHint': 'A run is the course and what happened at each obstacle. Never a picture.',
  'result.rematch': 'Rematch',
  'result.room': 'Back to the room',
  'result.leave': 'Leave the room',
  'rematch.one': '{name} wants a rematch',
  'rematch.many': '{n} players want a rematch',
  'rematch.left': '{name} left the room',
  'rematch.alone': 'Everyone else left the room.',
  // ---- leaving the stage ----
  'leave.title': 'Leave the race?',
  'leave.body': 'You leave the room too, and the others see that you left. Your points of this race are not kept.',
  'leave.confirm': 'Leave the race',
} as const;

export type LrKey = keyof typeof en;

export const tr: Readonly<Record<LrKey, string>> = {
  'joining': 'Odaya giriliyor',
  'wait.alone': 'İkinci oyuncu bekleniyor. Odanın bağlantısını paylaş.',
  'wait.one': '{name} hazırlanıyor, bekleniyor',
  'wait.many': '{n} oyuncunun hazırlanması bekleniyor',
  'wait.start': 'Herkes hazır. Yarış birazdan başlıyor.',
  'watch': 'Bu odada bir yarış sürüyor. Bir sonrakine katılırsın.',
  'count': 'Yarış {n} saniye sonra başlıyor',
  'go': 'Başla',
  'hold.camera': '{name} kişisinin kamerası bekleniyor',
  'hold.calibrating': '{name} kadraja giriyor',
  'hold.framing': '{name} kadrajdan çıktı',
  'hold.hidden': '{name} sayfadan kısa bir süre ayrıldı',
  'hold.user': '{name} yarışı duraklattı',
  'hold.offline': '{name} bağlantısını kaybetti. Yarış bekliyor.',
  'hold.many': 'Yarış {n} oyuncuyu bekliyor',
  'offline': 'Bağlantı koptu. Yeniden bağlanılıyor.',
  'settle': 'Yarışın sonucu bekleniyor',
  'tiles': 'Yarıştaki diğer oyuncular',
  'left': '{name} yarıştan ayrıldı',
  'reacts': 'Tepkiler',
  'said': '{name}: {text}',
  'result.left.one': '{name} yarıştan ayrıldı. Sen kazandın.',
  'result.left.many': 'Diğer herkes yarıştan ayrıldı. Sen kazandın.',
  'result.abandoned': 'Yarış, kimse bitiremeden iptal edildi.',
  'result.noContest': 'Yarış sayılamayacak kadar erken bitti, bu yüzden kazananı yok.',
  'result.early': '{name} erken ayrıldı, bu yüzden bu yarış sayılmıyor.',
  'result.list': 'Sıralama ve puanlar',
  'result.place': '{n}. sıra',
  'result.you': '{name} (sen)',
  'result.forfeit': 'Ayrıldı',
  'result.keep': '{name} kişisinin turunu sakla',
  'result.kept': '{name} kişisinin turu saklandı. Oyunun sayfasından onunla yarışabilirsin.',
  'result.keepHint': 'Bir tur, parkur ve her engelde ne olduğudur. Asla bir görüntü değildir.',
  'result.rematch': 'Rövanş',
  'result.room': 'Odaya dön',
  'result.leave': 'Odadan çık',
  'rematch.one': '{name} rövanş istiyor',
  'rematch.many': '{n} oyuncu rövanş istiyor',
  'rematch.left': '{name} odadan çıktı',
  'rematch.alone': 'Diğer herkes odadan çıktı.',
  'leave.title': 'Yarıştan çıkılsın mı?',
  'leave.body': 'Odadan da çıkarsın ve diğerleri çıktığını görür. Bu yarıştaki puanların saklanmaz.',
  'leave.confirm': 'Yarıştan çık',
};

registerGameStrings('lr', { en, tr });

/** `lr('wait.one', { name })`: a word of this file, in the page's language (German, Spanish and French get the English one). */
export function lrText(i18n: Pick<I18n, 'tx'>): (key: LrKey, vars?: Vars) => string {
  return (key, vars) => i18n.tx(`lr.${key}`, vars);
}
