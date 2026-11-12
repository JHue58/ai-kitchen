import {KitchenIcon} from '../../resources/icons/KitchenIcon';
import {kitchenIconName} from '../resources';

export function ResourceIcon({name,kind,size=24}:{name:string;kind:'equipment'|'ingredient'|'dish';size?:number}) {
  return <KitchenIcon name={kitchenIconName(name,kind)} width={size} height={size} className="kitchen-resource-icon"/>;
}
