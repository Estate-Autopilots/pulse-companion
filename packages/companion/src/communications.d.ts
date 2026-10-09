export type CommunicationSnapshot={person:{id:string;name:string};counts:{chats:number;inbox:number;total:number};rows:unknown[];settings?:unknown;suppression?:string|null};
export type Communications={todayHost:HTMLDivElement;attach:()=>void;refresh:()=>Promise<void>;status:(text:string|null)=>void;snapshot:(state:CommunicationSnapshot)=>void;open:(id:string,href?:string)=>void;showInbox:()=>void;destroy:()=>void};
export function mountCommunications(root:HTMLElement,options:{call:(path:string,body?:unknown)=>Promise<any>;onOpen:(href:string)=>void;onSwitch:()=>void;onResize?:()=>void;onEnablePings?:()=>void;isVisible?:()=>boolean;platform?:string}):Communications;
export function conversationTarget(href:string):string|null;
export function createFeed(options:Record<string,unknown>):{reset:(identity:string|null)=>void;poll:()=>Promise<void>};
