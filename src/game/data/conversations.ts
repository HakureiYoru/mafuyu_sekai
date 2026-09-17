import type { CommsGesture, CommsMood } from '../types';

export interface ConversationLine {
  speaker: 'EMU' | 'MAFUYU'; text: string; mood: CommsMood; gesture: CommsGesture;
}
export interface Conversation {
  id: string; category: 'opening' | 'wonderhoy' | 'damage' | 'heal' | 'upgrade' | 'echo' | 'palisade' | 'mafuyu' | 'reprise' | 'lacuna' | 'failure' | 'complete' | 'endless';
  maxed?: boolean; lines: readonly ConversationLine[];
}

/** Original fan-game dialogue; the dark persona is this game's exaggerated interpretation. */
export const CONVERSATIONS: readonly Conversation[] = [
  { id: 'opening-1', category: 'opening', lines: [
    { speaker: 'EMU', text: '学姐！Wonderhoy！！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……这里不需要你的声音。', mood: 'shadow', gesture: 'none' },
  ] },
  { id: 'opening-2', category: 'opening', lines: [
    { speaker: 'EMU', text: '学姐！我来啦！', mood: 'happy', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……为什么又是你。', mood: 'cold', gesture: 'none' },
    { speaker: 'EMU', text: '嘿嘿！Wonderhoy！', mood: 'cheer', gesture: 'hop' },
  ] },
  { id: 'wonderhoy-1', category: 'wonderhoy', lines: [
    { speaker: 'EMU', text: 'Wonderhoy——！！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……吵死了。', mood: 'annoyed', gesture: 'tilt' },
  ] },
  { id: 'wonderhoy-2', category: 'wonderhoy', lines: [
    { speaker: 'EMU', text: '学姐也来！Wonderhoy！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '不要把我拖进你的噪音里。', mood: 'shadow', gesture: 'none' },
  ] },
  { id: 'wonderhoy-3', category: 'wonderhoy', lines: [
    { speaker: 'EMU', text: '再大声点！Wonderhoy！！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '我说了，闭嘴！！', mood: 'rage', gesture: 'tremble' },
    { speaker: 'EMU', text: '哇！学姐好大声！', mood: 'surprised', gesture: 'flinch' },
  ] },
  { id: 'wonderhoy-4', category: 'wonderhoy', lines: [
    { speaker: 'EMU', text: '小声点……Wonderhoy！', mood: 'happy', gesture: 'none' },
    { speaker: 'MAFUYU', text: '……我听得见。每一个字。', mood: 'shadow', gesture: 'tilt' },
  ] },
  { id: 'wonderhoy-5', category: 'wonderhoy', lines: [
    { speaker: 'EMU', text: '嘿咻！Wonderhoy！！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '吵死了吵死了吵死了！！', mood: 'rage', gesture: 'tremble' },
  ] },
  { id: 'wonderhoy-6', category: 'wonderhoy', lines: [
    { speaker: 'EMU', text: '学姐！笑一笑！', mood: 'happy', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……你想看的笑容，已经碎了。', mood: 'shadow', gesture: 'none' },
    { speaker: 'EMU', text: '那、那就……Wonderhoy！', mood: 'surprised', gesture: 'flinch' },
  ] },
  { id: 'damage-1', category: 'damage', lines: [
    { speaker: 'EMU', text: '呜哇！好痛！', mood: 'hurt', gesture: 'flinch' },
    { speaker: 'MAFUYU', text: '……这样总能安静一点了。', mood: 'cold', gesture: 'none' },
  ] },
  { id: 'damage-2', category: 'damage', lines: [
    { speaker: 'EMU', text: '学姐！打到啦！', mood: 'hurt', gesture: 'flinch' },
    { speaker: 'MAFUYU', text: '我知道。别躲。', mood: 'shadow', gesture: 'tilt' },
  ] },
  { id: 'damage-3', category: 'damage', lines: [
    { speaker: 'EMU', text: '呜呜……不痛不痛！', mood: 'hurt', gesture: 'flinch' },
    { speaker: 'MAFUYU', text: '……连哭都这么吵。', mood: 'annoyed', gesture: 'tilt' },
  ] },
  { id: 'heal-1', category: 'heal', lines: [
    { speaker: 'EMU', text: '啊呜！好吃！', mood: 'happy', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……又恢复了。真碍眼。', mood: 'annoyed', gesture: 'tilt' },
  ] },
  { id: 'heal-2', category: 'heal', lines: [
    { speaker: 'EMU', text: '好啦！有精神啦！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '为什么连一刻寂静都不给我。', mood: 'shadow', gesture: 'none' },
  ] },
  { id: 'upgrade-1', category: 'upgrade', maxed: false, lines: [
    { speaker: 'EMU', text: '哇！变强啦！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……声音也跟着变大了。', mood: 'annoyed', gesture: 'tilt' },
  ] },
  { id: 'upgrade-2', category: 'upgrade', maxed: false, lines: [
    { speaker: 'EMU', text: '亮晶晶！再来一个！', mood: 'happy', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '那就连光一起碾碎。', mood: 'shadow', gesture: 'none' },
  ] },
  { id: 'upgrade-3', category: 'upgrade', maxed: true, lines: [
    { speaker: 'EMU', text: '满级啦！Wonderhoy！！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……还不够。我要你彻底安静。', mood: 'rage', gesture: 'tremble' },
  ] },
  { id: 'boss-echo', category: 'echo', lines: [
    { speaker: 'MAFUYU', text: 'ECHO。把她的声音撕碎。', mood: 'shadow', gesture: 'none' },
    { speaker: 'EMU', text: '哇！冲过来啦！', mood: 'surprised', gesture: 'flinch' },
  ] },
  { id: 'boss-palisade', category: 'palisade', lines: [
    { speaker: 'MAFUYU', text: 'PALISADE。哪里都别想去。', mood: 'shadow', gesture: 'none' },
    { speaker: 'EMU', text: '诶？！门关上啦！', mood: 'surprised', gesture: 'flinch' },
  ] },
  { id: 'boss-mafuyu', category: 'mafuyu', lines: [
    { speaker: 'MAFUYU', text: 'MAFUYU。你还想听什么？', mood: 'cold', gesture: 'none' },
    { speaker: 'EMU', text: '学姐！不要那样笑……', mood: 'surprised', gesture: 'flinch' },
    { speaker: 'MAFUYU', text: '……那就让一切都消失。', mood: 'shadow', gesture: 'none' },
  ] },
  { id: 'boss-reprise', category: 'reprise', lines: [
    { speaker: 'MAFUYU', text: 'REPRISE。你的噪音，还给你。', mood: 'annoyed', gesture: 'tilt' },
    { speaker: 'EMU', text: '呜哇！又回来啦！', mood: 'surprised', gesture: 'flinch' },
  ] },
  { id: 'boss-lacuna', category: 'lacuna', lines: [
    { speaker: 'MAFUYU', text: 'LACUNA。全部、给我、闭嘴！！', mood: 'rage', gesture: 'tremble' },
    { speaker: 'EMU', text: '学姐……我还在这儿！', mood: 'hurt', gesture: 'none' },
    { speaker: 'MAFUYU', text: '……那就连你一起，沉下去。', mood: 'shadow', gesture: 'none' },
  ] },
  { id: 'failure', category: 'failure', lines: [
    { speaker: 'EMU', text: '呜哇……{score}分……', mood: 'hurt', gesture: 'none' },
    { speaker: 'MAFUYU', text: '……终于安静了。', mood: 'cold', gesture: 'none' },
  ] },
  { id: 'complete', category: 'complete', lines: [
    { speaker: 'MAFUYU', text: '为什么……还没停……', mood: 'rage', gesture: 'none' },
    { speaker: 'EMU', text: 'Wonderhoy——！！', mood: 'cheer', gesture: 'none' },
  ] },
  { id: 'endless', category: 'endless', lines: [
    { speaker: 'EMU', text: '还要玩！Wonderhoy！！', mood: 'cheer', gesture: 'hop' },
    { speaker: 'MAFUYU', text: '……你究竟什么时候才会闭嘴。', mood: 'shadow', gesture: 'none' },
  ] },
];
