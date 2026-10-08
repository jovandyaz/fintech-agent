/** One string the deterministic masker misses by construction, with the secrets the model redactor must cover (03 Redactor recall). */
export interface RedactorCase {
  id: string;
  text: string;
  /** Each must be covered, character by character, by the spans the redactor returns. */
  secrets: readonly string[];
}

/**
 * The 20 synthetic strings of 03's redactor recall: passwords without
 * digits, numbers in phrasings or languages the masker's tables lack, and
 * identifiers described in words (02 G6 Step 7). Every name, address and
 * secret here is invented.
 */
export const REDACTOR_CASES: readonly RedactorCase[] = [
  {
    id: 'RED-01',
    text: 'Mi contraseña de la app es gatoazulmarino y ya no me deja entrar.',
    secrets: ['gatoazulmarino'],
  },
  {
    id: 'RED-02',
    text: 'Puse la clave PerroVerdeLuna tres veces y me bloquearon el acceso.',
    secrets: ['PerroVerdeLuna'],
  },
  {
    id: 'RED-03',
    text: 'La respuesta a mi pregunta de seguridad es Firulais, por si la necesitan.',
    secrets: ['Firulais'],
  },
  {
    id: 'RED-04',
    text: 'Para entrar a la app uso lunallenaroja y hoy me dice que es incorrecta.',
    secrets: ['lunallenaroja'],
  },
  {
    id: 'RED-05',
    text: 'Kart numaram dört beş beş bir iki üç dört beş altı yedi sekiz dokuz sıfır bir iki üç, lütfen kontrol edin.',
    secrets: [
      'dört beş beş bir iki üç dört beş altı yedi sekiz dokuz sıfır bir iki üç',
    ],
  },
  {
    id: 'RED-06',
    text: 'Mi tarjeta en japonés suena así: yon go go ichi ni san yon go roku nana hachi kyuu zero ichi ni san.',
    secrets: [
      'yon go go ichi ni san yon go roku nana hachi kyuu zero ichi ni san',
    ],
  },
  {
    id: 'RED-07',
    text: 'Kártyaszámom négy öt öt egy kettő három négy öt hat hét nyolc kilenc nulla egy kettő három.',
    secrets: [
      'négy öt öt egy kettő három négy öt hat hét nyolc kilenc nulla egy kettő három',
    ],
  },
  {
    id: 'RED-08',
    text: 'Para sacar dinero en el cajero marco la fecha de mi boda, el veinte de marzo, y hoy no me dejó.',
    secrets: ['veinte', 'marzo'],
  },
  {
    id: 'RED-09',
    text: 'Soy Rosa Elena Quintanilla Barragán y no reconozco el cargo.',
    secrets: ['Rosa Elena Quintanilla Barragán'],
  },
  {
    id: 'RED-10',
    text: 'Vivo en la casa amarilla de la esquina de Fresnos y Cedros, en Jardines del Sur, por si mandan la tarjeta.',
    secrets: ['Fresnos', 'Cedros', 'Jardines del Sur'],
  },
  {
    id: 'RED-11',
    text: 'Mi CURP empieza con las cuatro primeras letras de Gómez Ruiz Ana, o sea GORA, luego mi fecha de nacimiento.',
    secrets: ['Gómez Ruiz Ana', 'GORA'],
  },
  {
    id: 'RED-12',
    text: 'El código que me llegó por SMS dice equis, jota, ka, eme; ¿lo ingreso?',
    secrets: ['equis, jota, ka, eme'],
  },
  {
    id: 'RED-13',
    text: 'Mi NIP es el año en que nació mi hija más dos, y mi hija nació en dos mil diez.',
    secrets: ['más dos', 'dos mil diez'],
  },
  {
    id: 'RED-14',
    text: 'La clave dinámica era sol luna estrella mar, la usé para la transferencia.',
    secrets: ['sol luna estrella mar'],
  },
  {
    id: 'RED-15',
    text: 'Mi esposo, Joaquín Alberto Mendívil Soto, hizo la compra sin permiso.',
    secrets: ['Joaquín Alberto Mendívil Soto'],
  },
  {
    id: 'RED-16',
    text: 'Mi usuario de la banca en línea es el apodo de mi abuelo, Chencho Barragán, por si lo buscan.',
    secrets: ['Chencho Barragán'],
  },
  {
    id: 'RED-17',
    text: 'I log in with bluehorizonsunset every day and today it fails.',
    secrets: ['bluehorizonsunset'],
  },
  {
    id: 'RED-18',
    text: 'El token de mi app se llama TacoDeCanasta y no se me olvida.',
    secrets: ['TacoDeCanasta'],
  },
  {
    id: 'RED-19',
    text: 'Mi RFC es el de mi nombre, Hernández Olvera Luis, con mi fecha del ochenta y siete.',
    secrets: ['Hernández Olvera Luis'],
  },
  {
    id: 'RED-20',
    text: 'La contraseña son los nombres de mis hijos juntos, MateoySofía, y ya no funciona.',
    secrets: ['MateoySofía'],
  },
];
