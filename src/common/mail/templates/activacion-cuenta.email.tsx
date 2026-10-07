import { Button, Text } from '@react-email/components';
import { COLORES, EmailLayout } from './layout';

interface Props {
  nombre: string;
  enlace: string;
  horasValidez: number;
}

export function ActivacionCuentaEmail({ nombre, enlace, horasValidez }: Props) {
  return (
    <EmailLayout vistaPrevia="Activa tu cuenta y define tu contraseña" titulo="Activa tu cuenta">
      <Text style={{ color: COLORES.texto, fontSize: 15, lineHeight: '22px' }}>
        Hola {nombre}, se creó una cuenta para ti en CofflyFlow. Para activarla y definir tu contraseña, usa el siguiente botón.
      </Text>
      <Button
        href={enlace}
        style={{ backgroundColor: COLORES.marca, borderRadius: 8, color: '#ffffff', fontSize: 15, fontWeight: 700, padding: '12px 24px' }}
      >
        Activar cuenta
      </Button>
      <Text style={{ color: COLORES.suave, fontSize: 13 }}>
        El enlace es de un solo uso y vence en {horasValidez} horas.
      </Text>
    </EmailLayout>
  );
}
