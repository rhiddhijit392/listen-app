'use client';
import { useParams } from 'next/navigation';
import Room from '../../../components/Room';

export default function RoomPage() {
  const { id } = useParams();
  return <Room roomId={id} />;
}