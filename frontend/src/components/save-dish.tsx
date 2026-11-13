import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LoaderCircle } from 'lucide-react';
import { api, type Doc } from '../api';
import { Button } from './ui/button';

export function SaveDish({ menuId, index, dish }: { menuId: number; index: number; dish: any }) {
    const client = useQueryClient();
    const dishes = useQuery<Doc[]>({ queryKey: ['docs', 'dishes'], queryFn: () => api('/documents/dishes'), enabled: menuId > 0 });
    const lock = useRef(false);
    const [busy, setBusy] = useState(false), [savedId, setSavedId] = useState<number>(), [error, setError] = useState('');
    const existing = dishes.data?.find(d => d.id === dish.collection_id);
    const saved = !!savedId || !!existing?.saved;
    const id = savedId || existing?.id;
    async function save() {
        if (lock.current || saved) return;
        lock.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await api('/recipes/' + menuId + '/dishes/' + index, 'POST');
            setSavedId(result.id);
            await Promise.all([
                client.invalidateQueries({ queryKey: ['docs', 'dishes'] }),
                client.invalidateQueries({ queryKey: ['docs', 'recipes'] }),
                client.invalidateQueries({ queryKey: ['generation-result'] }),
            ]);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    return <div className="dish-save-control">
        <Button variant="secondary" disabled={busy || saved || menuId <= 0} onClick={() => void save()}>
            {busy ? <LoaderCircle size={16} className="spinner"/> : saved ? <Check size={16}/> : null}
            {busy ? '正在保存…' : saved ? '已保存到我的菜品' : '保存这道菜'}
        </Button>
        <span role="status" aria-live="polite">{error || (saved && id ? <Link to={'/dishes/' + id}>查看已保存的菜品 →</Link> : existing ? '已自动收录到我的菜品' : '')}</span>
    </div>;
}
