import { Text } from '@react-email/components';
import { COLORES, EmailLayout } from './layout';

interface Props {
  nombre: string;
  codigo: string;
  minutosValidez: number;
}

export function CodigoRecuperacionEmail({ nombre, codigo, minutosValidez }: Props) {
  return (
    <EmailLayout vistaPrevia="Tu código de recuperación" titulo="Recupera tu contraseña">
      <Text style={{ color: COLORES.texto, fontSize: 15, lineHeight: '22px' }}>
        Hola {nombre}, ingresa este código para continuar con el cambio de tu contraseña:
      </Text>
      <Text
        style={{
          backgroundColor: COLORES.fondo,
          borderRadius: 8,
          color: COLORES.marca,
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: 8,
          padding: '12px 0',
          textAlign: 'center',
        }}
      >
        {codigo}
      </Text>
      <Text style={{ color: COLORES.suave, fontSize: 13 }}>El código vence en {minutosValidez} minutos y solo se puede usar una vez.</Text>
    </EmailLayout>
  );
}
