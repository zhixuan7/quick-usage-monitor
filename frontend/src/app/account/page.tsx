'use client';
import Shell from '@/components/Shell';
import {PageHeader,Panel} from '@/components/shared';
export default function Account(){return <Shell><PageHeader title="Company account" subtitle="Your sign-in is managed through IAM Identity Center and Microsoft Entra ID."/><Panel><p>Change your password and authentication settings through your company identity provider. Dashboard access is granted through the monitoring group in IAM Identity Center.</p></Panel></Shell>;}
