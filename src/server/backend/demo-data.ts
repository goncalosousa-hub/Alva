/** The objects of the in-memory demo system (no SAP needed). */

export interface DemoObject {
  name: string;
  type: string;
  description: string;
  packageName: string;
  source: string;
  /** Extra class includes by kind ("testclasses", "definitions", ...). */
  includes?: Record<string, string>;
}

export interface DemoPackage {
  name: string;
  description: string;
  parent?: string;
  /** Local packages ($...) never need a transport request. */
  local: boolean;
}

export const DEMO_PACKAGES: DemoPackage[] = [
  { name: "ZALVA_DEMO", description: "Alva: demo de voos", local: false },
  { name: "ZALVA_DEMO_UTIL", description: "Utilitários", parent: "ZALVA_DEMO", local: false },
  { name: "$ZALVA_LOCAL", description: "Objetos locais (sem transporte)", local: true },
];

export const DEMO_TRANSPORTS = [
  { number: "DEVK900123", text: "Alva: serviço de voos", owner: "DEVELOPER" },
  { number: "DEVK900131", text: "Alva: utilitários", owner: "DEVELOPER" },
];

export const DEMO_OBJECTS: DemoObject[] = [
  {
    name: "ZIF_FLIGHT_REPOSITORY",
    type: "INTF/OI",
    description: "Acesso aos dados de voos",
    packageName: "ZALVA_DEMO",
    source: `INTERFACE zif_flight_repository PUBLIC.

  TYPES: BEGIN OF ty_flight,
           carrier  TYPE c LENGTH 3,
           connid   TYPE n LENGTH 4,
           fldate   TYPE d,
           price    TYPE p LENGTH 15 DECIMALS 2,
           currency TYPE c LENGTH 5,
           seatsmax TYPE i,
           seatsocc TYPE i,
         END OF ty_flight,
         tt_flights TYPE STANDARD TABLE OF ty_flight WITH EMPTY KEY.

  METHODS get_flights
    IMPORTING iv_carrier        TYPE ty_flight-carrier
    RETURNING VALUE(rt_flights) TYPE tt_flights.

ENDINTERFACE.
`,
  },
  {
    name: "ZCL_FLIGHT_SERVICE",
    type: "CLAS/OC",
    description: "Serviço de voos: ocupação e preços",
    packageName: "ZALVA_DEMO",
    source: `CLASS zcl_flight_service DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    TYPES tt_flights TYPE zif_flight_repository=>tt_flights.

    METHODS constructor
      IMPORTING io_repository TYPE REF TO zif_flight_repository.

    "! Flights of a carrier with at least one free seat
    METHODS get_available_flights
      IMPORTING iv_carrier        TYPE zif_flight_repository=>ty_flight-carrier
      RETURNING VALUE(rt_flights) TYPE tt_flights.

    "! Occupation of a flight in percent
    METHODS occupation
      IMPORTING is_flight         TYPE zif_flight_repository=>ty_flight
      RETURNING VALUE(rv_percent) TYPE i.

  PRIVATE SECTION.
    DATA mo_repository TYPE REF TO zif_flight_repository.

ENDCLASS.



CLASS zcl_flight_service IMPLEMENTATION.

  METHOD constructor.
    mo_repository = io_repository.
  ENDMETHOD.


  METHOD get_available_flights.
    LOOP AT mo_repository->get_flights( iv_carrier ) INTO DATA(ls_flight).
      IF ls_flight-seatsocc < ls_flight-seatsmax.
        INSERT ls_flight INTO TABLE rt_flights.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.


  METHOD occupation.
    IF is_flight-seatsmax = 0.
      RETURN.
    ENDIF.
    rv_percent = is_flight-seatsocc * 100 / is_flight-seatsmax.
  ENDMETHOD.

ENDCLASS.
`,
    includes: {
      definitions: `*"* use this source file for any type of declarations (class
*"* definitions, interfaces or type declarations) you need for
*"* components in the private section
`,
      implementations: `*"* use this source file for the definition and implementation of
*"* local helper classes, interface definitions and type
*"* declarations
`,
      macros: `*"* use this source file for any macro definitions you need
*"* in the implementation part of the class
`,
      testclasses: `CLASS ltd_repository DEFINITION FINAL FOR TESTING.
  PUBLIC SECTION.
    INTERFACES zif_flight_repository.
ENDCLASS.

CLASS ltd_repository IMPLEMENTATION.
  METHOD zif_flight_repository~get_flights.
    rt_flights = VALUE #( ( carrier = iv_carrier connid = '0001' seatsmax = 10 seatsocc = 10 )
                          ( carrier = iv_carrier connid = '0002' seatsmax = 10 seatsocc = 3 ) ).
  ENDMETHOD.
ENDCLASS.


CLASS ltc_flight_service DEFINITION FINAL FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PRIVATE SECTION.
    DATA mo_cut TYPE REF TO zcl_flight_service.
    METHODS setup.
    METHODS occupation_in_percent FOR TESTING.
    METHODS full_flights_are_skipped FOR TESTING.
ENDCLASS.


CLASS ltc_flight_service IMPLEMENTATION.

  METHOD setup.
    DATA lo_repository TYPE REF TO zif_flight_repository.
    lo_repository = NEW ltd_repository( ).
    mo_cut = NEW #( lo_repository ).
  ENDMETHOD.

  METHOD occupation_in_percent.
    cl_abap_unit_assert=>assert_equals(
      act = mo_cut->occupation( VALUE #( seatsmax = 200 seatsocc = 50 ) )
      exp = 25 ).
  ENDMETHOD.

  METHOD full_flights_are_skipped.
    DATA(lt_flights) = mo_cut->get_available_flights( 'TP' ).
    cl_abap_unit_assert=>assert_equals( act = lines( lt_flights ) exp = 1 ).
  ENDMETHOD.

ENDCLASS.
`,
    },
  },
  {
    name: "ZCL_STRING_UTILS",
    type: "CLAS/OC",
    description: "Funções de texto",
    packageName: "ZALVA_DEMO_UTIL",
    source: `CLASS zcl_string_utils DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    CLASS-METHODS capitalize
      IMPORTING iv_text        TYPE string
      RETURNING VALUE(rv_text) TYPE string.

    CLASS-METHODS repeat
      IMPORTING iv_text        TYPE string
                iv_times       TYPE i
      RETURNING VALUE(rv_text) TYPE string.

ENDCLASS.



CLASS zcl_string_utils IMPLEMENTATION.

  METHOD capitalize.
    rv_text = to_lower( iv_text ).
    IF strlen( rv_text ) > 0.
      rv_text = to_upper( rv_text(1) ) && substring( val = rv_text off = 1 ).
    ENDIF.
  ENDMETHOD.


  METHOD repeat.
    DO iv_times TIMES.
      rv_text = rv_text && iv_text.
    ENDDO.
  ENDMETHOD.

ENDCLASS.
`,
  },
  {
    name: "ZR_FLIGHT_REPORT",
    type: "PROG/P",
    description: "Relatório de voos disponíveis",
    packageName: "ZALVA_DEMO",
    source: `REPORT zr_flight_report.

CLASS lcl_memory_repository DEFINITION.
  PUBLIC SECTION.
    INTERFACES zif_flight_repository.
ENDCLASS.

CLASS lcl_memory_repository IMPLEMENTATION.
  METHOD zif_flight_repository~get_flights.
    rt_flights = VALUE #(
      ( carrier = iv_carrier connid = '0017' fldate = '20261015' price = '422.94' currency = 'EUR' seatsmax = 385 seatsocc = 372 )
      ( carrier = iv_carrier connid = '0064' fldate = '20261016' price = '499.00' currency = 'EUR' seatsmax = 220 seatsocc = 220 )
      ( carrier = iv_carrier connid = '0555' fldate = '20261020' price = '185.00' currency = 'EUR' seatsmax = 280 seatsocc = 115 ) ).
  ENDMETHOD.
ENDCLASS.

PARAMETERS p_carr TYPE c LENGTH 3 DEFAULT 'TP'.

START-OF-SELECTION.
  DATA lo_repository TYPE REF TO zif_flight_repository.
  lo_repository = NEW lcl_memory_repository( ).
  DATA(lo_service) = NEW zcl_flight_service( lo_repository ).

  LOOP AT lo_service->get_available_flights( CONV #( p_carr ) ) INTO DATA(ls_flight).
    WRITE: / ls_flight-carrier, ls_flight-connid, ls_flight-fldate,
             lo_service->occupation( ls_flight ), '%'.
  ENDLOOP.
`,
  },
  {
    name: "ZHELLO_ALVA",
    type: "PROG/P",
    description: "Olá Alva",
    packageName: "$ZALVA_LOCAL",
    source: `REPORT zhello_alva.

DATA lv_name TYPE string VALUE \`alva\`.

START-OF-SELECTION.
  WRITE / |Olá, { zcl_string_utils=>capitalize( lv_name ) }!|.
  WRITE / zcl_string_utils=>repeat( iv_text = \`=\` iv_times = 20 ).
`,
  },
];
