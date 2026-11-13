import type {CSSProperties,ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import '../color-stat-cards.css';

export type ColorStatItem={
 id:string;
 label:string;
 value:ReactNode;
 unit?:string;
 icon:LucideIcon;
 tone?:'lime'|'butter'|'orange'|'stone';
};

/** A shared, responsive surface for nutrition, time, cost and other small totals. */
export function ColorStatCards({items,label,className=''}:{items:ColorStatItem[];label:string;className?:string}){
 return <div className={'color-stat-cards '+className} aria-label={label} style={{'--stat-columns':items.length} as CSSProperties}>
  {items.map(({id,label,value,unit,icon:Icon,tone='lime'},index)=><div key={id} className={'color-stat-card tone-'+tone} style={{'--stat-order':index} as CSSProperties}>
   <span className="color-stat-icon" aria-hidden="true"><Icon size={21} strokeWidth={1.6}/></span>
   <div className="color-stat-copy"><small>{label}</small><strong>{value}{unit&&<em>{unit}</em>}</strong></div>
  </div>)}
 </div>;
}
