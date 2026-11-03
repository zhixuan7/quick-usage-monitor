'use client';
import {useEffect,useRef,useState} from 'react';
import {completeSso} from '@/lib/sso';
export default function Callback(){const ran=useRef(false);const [error,setError]=useState('');useEffect(()=>{if(!ran.current){ran.current=true;completeSso().catch(e=>setError(e.message));}},[]);return <main className="p-10"><h1 className="text-xl">{error?'Sign-in could not complete':'Completing company sign-in…'}</h1>{error&&<><p role="alert">{error}</p><a href="/login/">Return to sign-in</a></>}</main>;}
