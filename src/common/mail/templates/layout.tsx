import { Body, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

interface LayoutProps {
  vistaPrevia: string;
  titulo: string;
  children: ReactNode;
}

export const COLORES = { marca: '#6f4e37', fondo: '#f6f1ec', texto: '#2b2118', suave: '#7a6a5d' };

export function EmailLayout({ vistaPrevia, titulo, children }: LayoutProps) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{vistaPrevia}</Preview>
      <Body style={{ backgroundColor: COLORES.fondo, fontFamily: 'Arial, Helvetica, sans-serif', margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', borderRadius: 12, maxWidth: 480, padding: 32 }}>
          <Text style={{ color: COLORES.marca, fontSize: 14, fontWeight: 700, letterSpacing: 1, margin: 0 }}>COFFLYFLOW</Text>
          <Heading as="h1" style={{ color: COLORES.texto, fontSize: 22, margin: '16px 0' }}>
            {titulo}
          </Heading>
          <Section>{children}</Section>
          <Text style={{ color: COLORES.suave, fontSize: 12, marginTop: 32 }}>
            Si no esperabas este correo, puedes ignorarlo. Nunca compartas este código o enlace con nadie.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
