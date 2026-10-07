import { Text } from '@react-email/components';
import { COLORES, EmailLayout } from './layout';

interface Props {
  nombre: string;
  fecha: string;
}

export function PasswordCambiadaEmail({ nombre, fecha }: Props) {
  return (
    <EmailLayout vistaPrevia="Tu contraseña fue cambiada" titulo="Cambiaste tu contraseña">
      <Text style={{ color: COLORES.texto, fontSize: 15, lineHeight: '22px' }}>
        Hola {nombre}, tu contraseña de CofflyFlow se cambió el {fecha}. Cerramos tus otras sesiones abiertas.
      </Text>
      <Text style={{ color: COLORES.texto, fontSize: 15, lineHeight: '22px' }}>
        Si no fuiste tú, usa «Olvidé mi contraseña» ahora mismo y avisa al encargado del local.
      </Text>
    </EmailLayout>
  );
}
