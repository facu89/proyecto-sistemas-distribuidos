"""Genera la escena base de la home: planta en maceta, lámpara, ventilador y regadera.

Salidas (rutas relativas a diseño_pagina_web/):
  modelos/home.glb              lo que consume la web
  blender/home.blend            la escena, para retocar a mano
  blender/previews/*.png        renders de control: apagado y encendido

Uso (desde diseño_pagina_web/):
  flatpak run --env=LD_LIBRARY_PATH=/app/blender/lib org.blender.Blender \
      --background --factory-startup --python "$PWD/blender/generar_escena.py"

  LD_LIBRARY_PATH hace falta para que el flatpak encuentre meshoptimizer (compresión del .glb).
  Opciones (al final, después de `--`):
    --sin-previews     no renderiza las vistas previas (unos segundos en vez de ~1 min)
    --sin-compresion   exporta sin comprimir a modelos/home.sin-compresion.glb, sin tocar
                       home.glb. Sirve para comparar en la web con ?modelo=home.sin-compresion

Los nombres de objetos, materiales y acciones son el "contrato" con la web (ver PLAN.md).
Unidades: 1 = 1 metro de Blender. Z hacia arriba, la cámara mira hacia +Y.
"""

import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent.parent
SIN_PREVIEWS = "--sin-previews" in sys.argv  # para regenerar rápido solo el .glb
SIN_COMPRESION = "--sin-compresion" in sys.argv  # versión de comparación, ver el docstring

RUTA_GLB = BASE / "modelos" / ("home.sin-compresion.glb" if SIN_COMPRESION else "home.glb")
RUTA_BLEND = BASE / "blender" / "home.blend"
RUTA_PREVIEWS = BASE / "blender" / "previews"

FPS = 24


def meshopt_disponible():
    """El exportador glTF trae un puente a la librería meshoptimizer; en el flatpak de
    Blender la librería existe pero no está en la ruta de búsqueda."""
    try:
        # io_scene_gltf2 es el exportador glTF que viene dentro de Blender: el editor no lo
        # encuentra (no está instalado en el Python del sistema), pero en Blender existe.
        from io_scene_gltf2.io.exp import meshopt  # type: ignore  # noqa: F401
        import ctypes
        ctypes.CDLL("libmeshoptimizer.so")
        return True
    except (ImportError, OSError):
        return False


MESHOPT = not SIN_COMPRESION and meshopt_disponible()

if MESHOPT:
    # El exportador guarda las rotaciones de las animaciones con 8 bits por componente
    # (QUAT_FILTER_BITS, fijo en el código, sin opción en el menú). Eso da saltos de ~0,5°
    # y la planta, que se mueve 2-4°, se ve trabada. 16 es el máximo que admite meshopt
    # y deja el movimiento suave; el archivo crece muy poco.
    from io_scene_gltf2.io.exp import meshopt as _meshopt  # type: ignore  (solo existe en Blender)
    _meshopt.QUAT_FILTER_BITS = 16
if not MESHOPT and not SIN_COMPRESION:
    print("[generar_escena] AVISO: meshoptimizer no disponible, el .glb sale sin comprimir. "
          "En el flatpak: flatpak run --env=LD_LIBRARY_PATH=/app/blender/lib ...")

# Valores que comparten la planta y su esqueleto
Z_TIERRA = 0.86          # superficie de la tierra (base del tallo)
Z_FLOR = 2.05            # centro de la flor
HUESOS = [               # (nombre, z cabeza, z cola)
    ("Tallo_1", Z_TIERRA, 1.25),
    ("Tallo_2", 1.25, 1.65),
    ("Tallo_3", 1.65, 2.35),
]

# Poses de la regadera: (ubicación, rotación en grados)
REGADERA_PISO = ((1.45, -0.25, 0.25), (0, 0, 40))
REGADERA_ALZADA = ((1.50, 0.0, 1.60), (0, 0, 0))
REGADERA_RIEGO = ((1.45, 0.0, 1.80), (0, -50, 0))
REGADERA_FRAMES = (1, 19, 37)   # 1,5 s a 24 fps


# --------------------------------------------------------------------------- utilidades

def limpiar_escena():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    escena = bpy.context.scene
    escena.render.fps = FPS
    escena.frame_start = 1
    escena.frame_end = 97
    return escena


def nueva_coleccion(nombre):
    col = bpy.data.collections.new(nombre)
    bpy.context.scene.collection.children.link(col)
    return col


def mover_a(obj, coleccion):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coleccion.objects.link(obj)


def activar(*objs):
    """Deja seleccionados solo `objs` y el primero como activo (para los operadores)."""
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def material(nombre, color, rugosidad=0.6, metalico=0.0, transmision=0.0,
             emision=None, coat=0.0):
    mat = bpy.data.materials.get(nombre)
    if mat:
        return mat
    mat = bpy.data.materials.new(nombre)
    try:
        mat.use_nodes = True  # obsoleto en Blender 5 (siempre usa nodos), inofensivo
    except AttributeError:
        pass
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rugosidad
    bsdf.inputs["Metallic"].default_value = metalico
    bsdf.inputs["Transmission Weight"].default_value = transmision
    bsdf.inputs["Coat Weight"].default_value = coat
    if emision:
        # Se exporta apagado (intensidad 0): la web enciende el emissive.
        bsdf.inputs["Emission Color"].default_value = (*emision, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 0.0
    mat.diffuse_color = (*color, 1.0)  # color en la vista sólida
    return mat


def asignar(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def suavizar(obj, angulo=35):
    """Sombreado suave con aristas duras por ángulo (se exporta bien a glTF)."""
    me = obj.data
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=math.radians(angulo))
    except AttributeError:
        pass


def torno(nombre, perfil, pasos=48):
    """Malla de revolución alrededor de Z a partir de un perfil [(radio, z), ...]."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in perfil]
    aristas = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + aristas, axis=(0, 0, 1), cent=(0, 0, 0),
                   steps=pasos, angle=math.tau)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(nombre)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(nombre, me)
    bpy.context.scene.collection.objects.link(obj)
    suavizar(obj)
    return obj


def esfera(nombre, centro, escala, rot=(0, 0, 0), mat=None, seg=32, anillos=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=anillos, radius=1.0,
                                         location=centro, rotation=rot, scale=escala)
    obj = bpy.context.active_object
    obj.name = nombre
    suavizar(obj, 80)
    if mat:
        asignar(obj, mat)
    return obj


def cilindro(nombre, centro, radio, alto, rot=(0, 0, 0), mat=None, verts=32,
             tapa="NGON", radio2=None):
    if radio2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radio, depth=alto,
                                            end_fill_type=tapa, location=centro, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radio, radius2=radio2,
                                        depth=alto, end_fill_type=tapa,
                                        location=centro, rotation=rot)
    obj = bpy.context.active_object
    obj.name = nombre
    suavizar(obj)
    if mat:
        asignar(obj, mat)
    return obj


def toro(nombre, centro, mayor, menor, rot=(0, 0, 0), mat=None, seg=48, seg_menor=12):
    bpy.ops.mesh.primitive_torus_add(major_segments=seg, minor_segments=seg_menor,
                                     major_radius=mayor, minor_radius=menor,
                                     location=centro, rotation=rot)
    obj = bpy.context.active_object
    obj.name = nombre
    suavizar(obj, 80)
    if mat:
        asignar(obj, mat)
    return obj


def unir(nombre, principal, otros):
    """Une `otros` dentro de `principal` (conserva el origen de `principal`)."""
    activar(principal, *otros)
    bpy.ops.object.join()
    principal.name = nombre
    principal.data.name = nombre
    return principal


def recortar_con_cilindro(objs, radio, alto, centro=(0, 0, 0)):
    """Le resta a cada objeto un cilindro vertical (booleana de diferencia)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radio, depth=alto, location=centro)
    cortador = bpy.context.active_object
    for obj in objs:
        mod = obj.modifiers.new("Recorte", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.solver = "EXACT"
        mod.object = cortador
        activar(obj)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cortador, do_unlink=True)


def aplicar_transformaciones(obj):
    activar(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def empty(nombre, ubicacion=(0, 0, 0), tipo="PLAIN_AXES", tam=0.1):
    obj = bpy.data.objects.new(nombre, None)
    obj.empty_display_type = tipo
    obj.empty_display_size = tam
    obj.location = ubicacion
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rad(grados):
    return tuple(math.radians(g) for g in grados)


def guardar_accion(obj, nombre):
    """Renombra la acción activa, la pasa a una pista NLA y la desactiva.

    Así el objeto puede tener varias acciones y el exportador glTF (modo Acciones)
    las exporta como clips separados.
    """
    ad = obj.animation_data
    accion = ad.action
    accion.name = nombre
    accion.use_fake_user = True
    pista = ad.nla_tracks.new()
    pista.name = nombre
    tira = pista.strips.new(nombre, int(accion.frame_range[0]), accion)
    if hasattr(tira, "action_slot") and tira.action_slot is None and len(accion.slots):
        tira.action_slot = accion.slots[0]
    ad.action = None
    return accion


# --------------------------------------------------------------------------- materiales

def crear_materiales():
    return {
        "terracota": material("Terracota", (0.55, 0.15, 0.055), rugosidad=0.9),
        "tierra": material("Tierra", (0.10, 0.06, 0.035), rugosidad=1.0),
        "tallo": material("Tallo", (0.12, 0.30, 0.06), rugosidad=0.55),
        "hoja": material("Hoja", (0.16, 0.36, 0.07), rugosidad=0.5),
        "petalo": material("Petalo", (1.0, 0.45, 0.02), rugosidad=0.45, coat=0.2),
        "centro": material("Centro_Flor", (0.85, 0.20, 0.01), rugosidad=0.5, coat=0.2),
        "vidrio": material("Vidrio", (1.0, 0.97, 0.92), rugosidad=0.3, transmision=0.85,
                           emision=(1.0, 0.78, 0.45)),
        "filamento": material("Filamento", (0.6, 0.45, 0.3), rugosidad=0.4, metalico=0.5,
                              emision=(1.0, 0.65, 0.3)),
        "rosca": material("Metal_Rosca", (0.75, 0.73, 0.70), rugosidad=0.3, metalico=1.0),
        "ventilador": material("Ventilador_Cuerpo", (0.80, 0.74, 0.70), rugosidad=0.55),
        "aspa": material("Ventilador_Aspa", (0.72, 0.56, 0.52), rugosidad=0.5),
        "regadera": material("Regadera", (0.09, 0.25, 0.75), rugosidad=0.3, metalico=0.6,
                             coat=0.3),
    }


# --------------------------------------------------------------------------- objetos

def crear_maceta(m):
    perfil = [  # (radio, z): base, pared exterior, borde, pared interior
        (0.0, 0.0), (0.38, 0.0), (0.41, 0.012), (0.425, 0.04),
        (0.50, 0.70), (0.59, 0.715), (0.615, 0.74), (0.625, 0.88),
        (0.615, 0.915), (0.585, 0.925), (0.56, 0.91), (0.548, 0.86),
        (0.53, 0.78), (0.0, 0.78),
    ]
    maceta = torno("Maceta", perfil, pasos=64)
    asignar(maceta, m["terracota"])
    bev = maceta.modifiers.new("Bisel", "BEVEL")
    bev.width = 0.008
    bev.segments = 2
    bev.limit_method = "ANGLE"

    tierra = torno("Tierra", [(0.0, Z_TIERRA + 0.01), (0.3, Z_TIERRA), (0.552, Z_TIERRA - 0.02),
                              (0.545, 0.80)], pasos=64)
    asignar(tierra, m["tierra"])
    return [maceta, tierra]


def crear_planta(m):
    # Tallo: curva Bézier con grosor, convertida a malla
    # El último tramo se va hacia atrás (+Y, lejos de la cámara) para entrar por la espalda
    # de la flor: así queda detrás de los pétalos y no los atraviesa.
    puntos = [(0, 0, Z_TIERRA - 0.03), (0.05, 0, 1.30), (-0.02, 0.05, 1.70),
              (0, 0.13, Z_FLOR - 0.03)]
    radios = [1.25, 1.05, 0.95, 0.9]
    curva = bpy.data.curves.new("Tallo", "CURVE")
    curva.dimensions = "3D"
    curva.bevel_depth = 0.042
    curva.bevel_resolution = 4
    curva.resolution_u = 16
    curva.use_fill_caps = True
    spline = curva.splines.new("BEZIER")
    spline.bezier_points.add(len(puntos) - 1)
    for bp, p, r in zip(spline.bezier_points, puntos, radios):
        bp.co = p
        bp.radius = r
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    tallo = bpy.data.objects.new("Tallo", curva)
    bpy.context.scene.collection.objects.link(tallo)
    activar(tallo)
    bpy.ops.object.convert(target="MESH")
    tallo = bpy.context.active_object
    suavizar(tallo, 80)
    asignar(tallo, m["tallo"])

    # Hojas: elipsoides que salen del tallo hacia arriba
    hojas = []
    for nombre, z, rot_y, lado in [("Hoja_Izq", 1.22, -155, -1), ("Hoja_Der", 1.33, -25, 1)]:
        direccion = Vector((math.cos(math.radians(rot_y)), 0, -math.sin(math.radians(rot_y))))
        centro = Vector((0.0, 0.0, z)) + direccion * 0.27
        hoja = esfera(nombre, centro, (0.28, 0.05, 0.095), rot=(0, math.radians(rot_y),
                      math.radians(8 * lado)), mat=m["hoja"])
        hojas.append(hoja)

    # Flor: seis pétalos en el plano XZ (mirando a la cámara) y el centro
    flor = []
    for i in range(6):
        ang = math.radians(90 + i * 60)
        direccion = Vector((math.cos(ang), 0, -math.sin(ang)))
        centro = Vector((0, 0.02, Z_FLOR)) + direccion * 0.25
        flor.append(esfera(f"Petalo_{i}", centro, (0.21, 0.075, 0.155), rot=(0, ang, 0),
                           mat=m["petalo"]))
    flor.append(esfera("Centro_Flor", (0, -0.06, Z_FLOR), (0.15, 0.10, 0.15), mat=m["centro"]))

    partes = [tallo, *hojas, *flor]
    for p in partes:
        aplicar_transformaciones(p)

    # Pesos: el tallo y las hojas se reparten entre los huesos según la altura;
    # la flor completa va al último hueso para que no se deforme.
    centros = [(h0 + h1) / 2 for _, h0, h1 in HUESOS]

    def pesos_por_altura(z):
        if z <= centros[0]:
            return [1.0, 0.0, 0.0]
        if z >= centros[-1]:
            return [0.0, 0.0, 1.0]
        for i in range(len(centros) - 1):
            if centros[i] <= z < centros[i + 1]:
                t = (z - centros[i]) / (centros[i + 1] - centros[i])
                w = [0.0] * len(centros)
                w[i], w[i + 1] = 1 - t, t
                return w

    for parte in partes:
        grupos = [parte.vertex_groups.new(name=n) for n, _, _ in HUESOS]
        es_flor = parte in flor
        for v in parte.data.vertices:
            pesos = [0.0, 0.0, 1.0] if es_flor else pesos_por_altura(v.co.z)
            for g, w in zip(grupos, pesos):
                if w > 0:
                    g.add([v.index], w, "REPLACE")

    planta = unir("Planta", tallo, partes[1:])

    # Esqueleto
    datos = bpy.data.armatures.new("Planta_Esqueleto")
    esqueleto = bpy.data.objects.new("Planta_Esqueleto", datos)
    bpy.context.scene.collection.objects.link(esqueleto)
    activar(esqueleto)
    bpy.ops.object.mode_set(mode="EDIT")
    anterior = None
    for nombre, z0, z1 in HUESOS:
        hueso = datos.edit_bones.new(nombre)
        hueso.head = (0, 0, z0)
        hueso.tail = (0, 0, z1)
        hueso.roll = 0
        if anterior:
            hueso.parent = anterior
            hueso.use_connect = True
        anterior = hueso
    bpy.ops.object.mode_set(mode="OBJECT")
    datos.display_type = "STICK"

    planta.parent = esqueleto
    mod = planta.modifiers.new("Esqueleto", "ARMATURE")
    mod.object = esqueleto

    animar_planta(esqueleto)
    return [esqueleto, planta]


def animar_planta(esqueleto):
    huesos = [esqueleto.pose.bones[n] for n, _, _ in HUESOS]
    for pb in huesos:
        pb.rotation_mode = "XYZ"

    # Brisa: 4 s en loop. Cada hueso se balancea un poco más y con algo de retraso
    # respecto del anterior, así el tallo se curva como un látigo suave.
    duracion = 96
    amp_lado = [2.0, 3.0, 4.5]      # grados, balanceo izquierda-derecha
    amp_fondo = [0.6, 0.9, 1.4]     # grados, balanceo hacia/desde la cámara
    for f in range(0, duracion + 1, 4):
        t = f / duracion
        for i, pb in enumerate(huesos):
            lado = math.radians(amp_lado[i]) * math.sin(math.tau * t - i * 0.6)
            fondo = math.radians(amp_fondo[i]) * math.sin(2 * math.tau * t + i)
            pb.rotation_euler = (fondo, 0.0, lado)
            pb.keyframe_insert("rotation_euler", frame=f + 1)
    guardar_accion(esqueleto, "Planta_Brisa")

    # Viento (ventilador encendido): 4 s en loop, igual que la brisa. El tallo se inclina
    # un poco hacia +X, lejos del ventilador, y se mece algo más rápido y amplio que con
    # la brisa, pero sin sacudidas: tiene que verse como aire que la acaricia, no que la daña.
    # La web lo mezcla con la brisa.
    # El signo de la rotación que inclina hacia +X depende de los ejes locales del hueso:
    # se mide en vez de suponerlo.
    huesos[0].rotation_euler = (0, 0, 0.2)
    bpy.context.view_layer.update()
    hacia_x = 1 if (esqueleto.matrix_world @ huesos[0].tail).x > 0 else -1
    huesos[0].rotation_euler = (0, 0, 0)

    duracion = 96
    inclinacion = [1.5, 2.2, 3.0]   # grados, inclinación constante
    amp_vaiven = [1.5, 2.3, 3.4]    # grados, vaivén (2 ciclos por loop = cada 2 s)
    amp_fondo = [0.5, 0.8, 1.2]
    for f in range(0, duracion + 1, 4):
        t = f / duracion
        for i, pb in enumerate(huesos):
            onda = math.sin(2 * math.tau * t - i * 0.6) + 0.2 * math.sin(3 * math.tau * t - i)
            lado = math.radians(inclinacion[i] + amp_vaiven[i] * onda) * hacia_x
            fondo = math.radians(amp_fondo[i]) * math.sin(math.tau * t + i)
            pb.rotation_euler = (fondo, 0.0, lado)
            pb.keyframe_insert("rotation_euler", frame=f + 1)
    guardar_accion(esqueleto, "Planta_Viento")

    # Latido: 2 s en loop. La flor late dos veces y descansa.
    for pb in huesos:
        pb.rotation_euler = (0, 0, 0)
    flor = huesos[-1]
    for f, s in [(1, 1.0), (7, 1.07), (13, 1.0), (19, 1.04), (27, 1.0), (49, 1.0)]:
        flor.scale = (s, s, s)
        flor.keyframe_insert("scale", frame=f)
    guardar_accion(esqueleto, "Planta_Latido")

    # Pose de reposo neutra
    for pb in huesos:
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def crear_lampara(m):
    grupo = empty("Lampara", tipo="SPHERE", tam=0.35)

    vidrio = torno("Lampara_Vidrio", [
        (0.0, -0.32), (0.12, -0.305), (0.22, -0.245), (0.29, -0.145), (0.32, -0.02),
        (0.31, 0.09), (0.27, 0.19), (0.205, 0.275), (0.16, 0.35), (0.145, 0.44),
    ])
    asignar(vidrio, m["vidrio"])
    vidrio.modifiers.new("Suavizado", "SUBSURF").levels = 2  # se aplica al exportar

    rosca = torno("Lampara_Rosca", [
        (0.13, 0.41), (0.152, 0.45), (0.152, 0.48), (0.138, 0.50), (0.152, 0.52),
        (0.152, 0.55), (0.138, 0.57), (0.152, 0.59), (0.152, 0.62), (0.138, 0.64),
        (0.152, 0.66), (0.15, 0.69), (0.12, 0.72), (0.07, 0.74), (0.04, 0.765), (0.0, 0.77),
    ])
    asignar(rosca, m["rosca"])

    # Filamento: espiral chica sostenida por dos alambres
    espiral = toro("Lampara_Filamento", (0, 0, -0.02), 0.06, 0.007, rot=(math.pi / 2, 0, 0),
                   mat=m["filamento"], seg=24, seg_menor=6)
    alambres = [cilindro(f"Alambre_{i}", (x, 0, 0.17), 0.006, 0.38, mat=m["filamento"], verts=8)
                for i, x in enumerate((-0.06, 0.06))]
    filamento = unir("Lampara_Filamento", espiral, alambres)

    for parte in (vidrio, rosca, filamento):
        parte.parent = grupo
    grupo.location = (0, 0, 3.35)
    return [grupo, vidrio, rosca, filamento]


def crear_ventilador(m):
    """El ventilador se arma mirando a -Y (a la cámara) y después se gira hacia la planta."""
    grupo = empty("Ventilador", tipo="CIRCLE", tam=0.5)
    de_frente = (math.pi / 2, 0, 0)  # lleva el plano XY al plano XZ

    # Marco: aro exterior, banda lateral, rejilla de rayos y motor atrás
    aro = toro("Ventilador_Marco", (0, -0.06, 0), 0.45, 0.04, rot=de_frente, mat=m["ventilador"])
    banda = cilindro("Banda", (0, 0, 0), 0.47, 0.14, rot=de_frente, mat=m["ventilador"],
                     verts=64, tapa="NOTHING")
    banda.modifiers.new("Grosor", "SOLIDIFY").thickness = 0.03
    aro_atras = toro("Aro_Atras", (0, 0.07, 0), 0.45, 0.025, rot=de_frente, mat=m["ventilador"])
    rayos = []
    for i in range(18):
        ang = i * math.tau / 18
        centro = (math.cos(ang) * 0.27, 0.07, math.sin(ang) * 0.27)
        rayos.append(cilindro(f"Rayo_{i}", centro, 0.009, 0.36, rot=(0, math.pi / 2 - ang, 0),
                              mat=m["ventilador"], verts=8))
    motor = cilindro("Motor", (0, 0.11, 0), 0.12, 0.12, rot=de_frente, mat=m["ventilador"])
    for p in (banda, motor):
        activar(p)
        bpy.ops.object.modifier_apply(modifier=p.modifiers[0].name) if p.modifiers else None
    marco = unir("Ventilador_Marco", aro, [banda, aro_atras, motor, *rayos])

    # Aspas: cuatro palas inclinadas alrededor de un cubo. Origen = eje de giro.
    cubo = esfera("Ventilador_Aspas", (0, 0, 0), (0.075, 0.06, 0.075), mat=m["aspa"])
    palas = []
    for i in range(4):
        ang = math.radians(45 + i * 90)
        direccion = Vector((math.cos(ang), 0, -math.sin(ang)))
        palas.append(esfera(f"Pala_{i}", direccion * 0.2, (0.17, 0.02, 0.1),
                            rot=(math.radians(25), ang, 0), mat=m["aspa"]))
    for p in palas:
        aplicar_transformaciones(p)
    aspas = unir("Ventilador_Aspas", cubo, palas)
    aspas.location = (0, -0.01, 0)

    for parte in (marco, aspas):
        parte.parent = grupo
    grupo.location = (-1.75, 0.1, 2.15)
    grupo.rotation_euler = rad((0, 0, 50))  # mira hacia la planta y algo a la cámara
    return [grupo, marco, aspas]


def crear_regadera(m):
    """Cuerpo centrado en el origen; el pico apunta a -X en coordenadas locales."""
    cuerpo = cilindro("Regadera", (0, 0, 0), 0.30, 0.50, mat=m["regadera"], verts=48)
    # Abrir la tapa de arriba para que se vea el interior
    bm = bmesh.new()
    bm.from_mesh(cuerpo.data)
    arriba = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=arriba, context="FACES_ONLY")
    bm.to_mesh(cuerpo.data)
    bm.free()
    cuerpo.modifiers.new("Grosor", "SOLIDIFY").thickness = 0.02
    activar(cuerpo)
    bpy.ops.object.modifier_apply(modifier="Grosor")

    borde = toro("Borde", (0, 0, 0.25), 0.29, 0.022, mat=m["regadera"])
    base = toro("Base", (0, 0, -0.245), 0.29, 0.015, mat=m["regadera"])
    # Asa: aro en el plano XZ, del lado opuesto al pico. Las uniones con el cuerpo quedan
    # en z ≈ 0.19 y z ≈ -0.17 (debajo del borde, para que no se vea por la boca).
    asa = toro("Asa", (0.32, 0, 0.01), 0.18, 0.032, rot=(math.pi / 2, 0, 0), mat=m["regadera"])
    # Placas donde el asa se une al cuerpo (como las soldaduras de una regadera real)
    placas = [esfera(f"Placa_{i}", (0.295, 0, z), (0.022, 0.05, 0.05), mat=m["regadera"])
              for i, z in enumerate((0.19, -0.17))]

    # Pico: cono fino inclinado 35° hacia arriba, y la flor de riego en la punta
    inclinacion = math.radians(-55)
    direccion = Vector((math.sin(inclinacion), 0, math.cos(inclinacion)))
    inicio = Vector((-0.20, 0, -0.12))
    pico = cilindro("Pico", inicio + direccion * 0.3, 0.06, 0.6, rot=(0, inclinacion, 0),
                    mat=m["regadera"], radio2=0.035, verts=24)
    punta = inicio + direccion * 0.6
    flor_riego = cilindro("Flor_Riego", punta + direccion * 0.035, 0.04, 0.08,
                          rot=(0, inclinacion, 0), mat=m["regadera"], radio2=0.085, verts=24)
    for p in (borde, base, asa, pico, flor_riego, *placas):
        aplicar_transformaciones(p)
    # El asa, sus placas y el pico se recortan contra el cuerpo: terminan dentro del espesor de la pared
    # (entre r=0.28 y r=0.30), así no se ven atravesándolo por dentro.
    recortar_con_cilindro([asa, pico, *placas], radio=0.29, alto=0.6)
    regadera = unir("Regadera", cuerpo, [borde, base, asa, pico, flor_riego, *placas])

    boquilla = empty("Regadera_Boquilla", punta + direccion * 0.08, tipo="SINGLE_ARROW", tam=0.15)
    boquilla.rotation_euler = (0, inclinacion, 0)  # la flecha (Z local) apunta hacia afuera
    boquilla.parent = regadera

    # Animación: del piso a la pose de riego
    for frame, (loc, rot) in zip(REGADERA_FRAMES, (REGADERA_PISO, REGADERA_ALZADA, REGADERA_RIEGO)):
        regadera.location = loc
        regadera.rotation_euler = rad(rot)
        regadera.keyframe_insert("location", frame=frame)
        regadera.keyframe_insert("rotation_euler", frame=frame)
    guardar_accion(regadera, "Regadera_Regar")

    # Reposo = apagada, apoyada en el piso
    regadera.location = REGADERA_PISO[0]
    regadera.rotation_euler = rad(REGADERA_PISO[1])
    return [regadera, boquilla]


# --------------------------------------------------------------------------- render de control

def crear_estudio(coleccion):
    """Fondo curvo, luces y cámara. Solo sirven para las vistas previas: no se exportan."""
    # Fondo: perfil en L con curva suave, extruido en X
    perfil = [(-10.0, 0.0), (2.0, 0.0)]
    radio = 3.0
    for i in range(1, 13):
        a = i / 12 * math.pi / 2
        perfil.append((2.0 + math.sin(a) * radio, radio - math.cos(a) * radio))
    perfil.append((5.0, 14.0))
    bm = bmesh.new()
    izq = [bm.verts.new((-15, y, z)) for y, z in perfil]
    der = [bm.verts.new((15, y, z)) for y, z in perfil]
    for i in range(len(perfil) - 1):
        bm.faces.new((izq[i], izq[i + 1], der[i + 1], der[i]))
    me = bpy.data.meshes.new("Fondo")
    bm.to_mesh(me)
    bm.free()
    fondo = bpy.data.objects.new("Fondo", me)
    coleccion.objects.link(fondo)
    suavizar(fondo, 30)
    asignar(fondo, material("Fondo", (0.30, 0.25, 0.20), rugosidad=0.9))

    principal = bpy.data.lights.new("Luz_Principal", "AREA")
    principal.energy = 900
    principal.size = 5
    principal.color = (1.0, 0.96, 0.9)
    obj = bpy.data.objects.new("Luz_Principal", principal)
    obj.location = (-3.5, -4.5, 6.5)
    obj.rotation_euler = rad((40, 0, -35))
    coleccion.objects.link(obj)

    relleno = bpy.data.lights.new("Luz_Relleno", "AREA")
    relleno.energy = 250
    relleno.size = 6
    relleno.color = (0.9, 0.93, 1.0)
    obj = bpy.data.objects.new("Luz_Relleno", relleno)
    obj.location = (5, -4, 2.5)
    obj.rotation_euler = rad((70, 0, 50))
    coleccion.objects.link(obj)

    mundo = bpy.data.worlds.new("Mundo")
    bpy.context.scene.world = mundo
    try:
        mundo.use_nodes = True
    except AttributeError:
        pass
    fondo_mundo = next(n for n in mundo.node_tree.nodes if n.type == "BACKGROUND")
    fondo_mundo.inputs["Color"].default_value = (0.45, 0.42, 0.38, 1)
    fondo_mundo.inputs["Strength"].default_value = 0.5

    datos_cam = bpy.data.cameras.new("Camara")
    datos_cam.lens = 50
    cam = bpy.data.objects.new("Camara", datos_cam)
    cam.location = (0, -8.6, 2.0)
    cam.rotation_euler = rad((90 - math.degrees(math.atan2(0.1, 8.6)), 0, 0))
    coleccion.objects.link(cam)
    bpy.context.scene.camera = cam

    escena = bpy.context.scene
    escena.render.engine = "CYCLES"
    escena.cycles.samples = 64
    escena.cycles.use_denoising = True
    escena.render.resolution_x = 660
    escena.render.resolution_y = 880
    escena.view_settings.view_transform = "AgX"


def poner_emision(nombre_mat, fuerza):
    bsdf = next(n for n in bpy.data.materials[nombre_mat].node_tree.nodes
                if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Emission Strength"].default_value = fuerza


def render(nombre):
    RUTA_PREVIEWS.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(RUTA_PREVIEWS / f"{nombre}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[generar_escena] preview: {RUTA_PREVIEWS / nombre}.png")


def renders_de_control(coleccion_render):
    escena = bpy.context.scene

    # Apagado: frame 1 (regadera en el piso)
    escena.frame_set(1)
    render("apagado")

    # Encendido: regadera regando (último frame de su acción) y lámpara prendida
    escena.frame_set(REGADERA_FRAMES[-1])
    poner_emision("Vidrio", 2.5)
    poner_emision("Filamento", 25.0)
    bpy.data.objects["Lampara_Vidrio"].visible_shadow = False  # que la luz salga del vidrio
    datos = bpy.data.lights.new("Luz_Lampara", "POINT")
    datos.energy = 120
    datos.color = (1.0, 0.8, 0.55)
    datos.shadow_soft_size = 0.15
    luz = bpy.data.objects.new("Luz_Lampara", datos)
    luz.location = bpy.data.objects["Lampara"].location + Vector((0, 0, -0.02))
    coleccion_render.objects.link(luz)
    render("encendido")


# --------------------------------------------------------------------------- principal

def main():
    limpiar_escena()
    exportar = nueva_coleccion("Exportar")
    solo_render = nueva_coleccion("Solo_Render")

    m = crear_materiales()
    objetos = []
    objetos += crear_maceta(m)
    objetos += crear_planta(m)
    objetos += crear_lampara(m)
    objetos += crear_ventilador(m)
    objetos += crear_regadera(m)
    for obj in objetos:
        mover_a(obj, exportar)
    # Hijos que quedaron sueltos en la colección raíz
    for obj in list(bpy.context.scene.collection.objects):
        mover_a(obj, exportar)

    crear_estudio(solo_render)
    bpy.context.scene.frame_set(1)

    # Exportar solo la colección "Exportar"
    RUTA_GLB.parent.mkdir(parents=True, exist_ok=True)
    activar(*exportar.objects)
    bpy.ops.export_scene.gltf(
        filepath=str(RUTA_GLB),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_anim_slide_to_zero=True,   # los clips empiezan en t=0
        # Compresión Meshopt: la web la decodifica sola (drei trae el decodificador).
        # En el flatpak hay que correr Blender con LD_LIBRARY_PATH=/app/blender/lib
        # (ver el docstring); si no, la librería no carga y se exporta sin comprimir.
        export_meshopt_compression_enable=MESHOPT,
        export_skins=True,
        export_lights=False,
        export_cameras=False,
    )
    print(f"[generar_escena] glb: {RUTA_GLB} ({os.path.getsize(RUTA_GLB) / 1024:.0f} KiB)")

    bpy.ops.wm.save_as_mainfile(filepath=str(RUTA_BLEND))
    print(f"[generar_escena] blend: {RUTA_BLEND}")

    if not SIN_PREVIEWS:
        renders_de_control(solo_render)


main()
