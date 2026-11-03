'use client';
import {useState} from 'react';
import {startSso} from '@/lib/sso';
import QuickLogo from '@/components/QuickLogo';
import {Button} from '@/components/ui/button';
export default function Login(){const [error,setError]=useState('');const [busy,setBusy]=useState(false);return <main className="flex min-h-screen items-center justify-center p-6"><section className="w-full max-w-md space-y-6 rounded-xl border bg-white p-8"><QuickLogo className="h-10 w-10"/><div><h1 className="text-2xl font-semibold">Quick Usage Monitor</h1><p className="mt-2 text-muted-foreground">Usage, identity groups and resource audit activity.</p></div><Button className="w-full" disabled={busy} onClick={()=>{setBusy(true);startSso().catch(e=>{setError(e.message);setBusy(false);});}}>{busy?'Connecting…':'Sign in with your company account'}</Button><p className="text-sm text-muted-foreground">Use your Microsoft Entra ID account through IAM Identity Center. Access is limited to authorized monitoring groups.</p>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}</section></main>;}
