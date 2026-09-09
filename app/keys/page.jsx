import { redirect } from 'next/navigation';

/* API keys are hidden in the preview build. Restore by rendering <Keys /> from '@/components/screens/Keys'. */
export default function Page() {
  redirect('/contracts');
}
