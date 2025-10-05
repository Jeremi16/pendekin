import { redirect } from 'next/navigation';
import { links } from '../api/shorten/route'; // Import dari API route

export default function RedirectPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const originalUrl = links[slug];
  
  if (originalUrl) {
    redirect(originalUrl);
  }
  
  // Handle 404
  redirect('/');
}